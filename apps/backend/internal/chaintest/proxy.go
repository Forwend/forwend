package chaintest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
)

// Call is one request a Proxy received (a JSON-RPC call, or a batch with Method "batch") and how it was answered.
type Call struct {
	Path, Method string
	Methods      []string
	Params       []json.RawMessage
	Fault        Fault
}

type Fault int

const (
	Forward Fault = iota
	HTTP429
	HTTP503
	RateLimited    // as Infura answers over its rate limit
	TooManyResults // as Infura answers a big log query
	TooManyTopics  // as go-ethereum nodes answer over 1,000 topic values
	InternalError
	Hang   // no answer until the client gives up
	Stale  // answered with the result of the proxy's Stale rule, as a lagging node would
	Pruned // as a node answers for history it no longer keeps (PublicNode and Blockdaemon on Arc)
)

type Proxy struct {
	URL string

	mu    sync.Mutex
	rule  func(Call) Fault
	stale func(Call) json.RawMessage
	calls []Call
}

func (a *Anvil) Proxy() *Proxy {
	p := &Proxy{}
	stop := make(chan struct{})
	anvil := &http.Client{Transport: &http.Transport{MaxIdleConnsPerHost: 100}} // keeps connections for load tests
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var one struct {
			ID     json.RawMessage   `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		c := Call{Path: r.URL.Path, Method: "batch"}
		if json.Unmarshal(body, &one) == nil {
			c.Method, c.Params = one.Method, one.Params
			c.Methods = []string{one.Method}
		} else {
			var batch []struct {
				Method string `json:"method"`
			}
			if json.Unmarshal(body, &batch) == nil {
				for _, call := range batch {
					c.Methods = append(c.Methods, call.Method)
				}
			}
		}
		var result json.RawMessage
		p.mu.Lock()
		if p.stale != nil && c.Method != "batch" {
			if result = p.stale(c); result != nil {
				c.Fault = Stale
			}
		}
		if p.rule != nil && c.Fault == Forward {
			c.Fault = p.rule(c)
		}
		p.calls = append(p.calls, c)
		p.mu.Unlock()
		id := string(one.ID)
		if id == "" {
			id = "null"
		}
		switch c.Fault {
		case HTTP429:
			http.Error(w, `{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"project ID request rate exceeded"}}`,
				http.StatusTooManyRequests)
		case HTTP503:
			http.Error(w, "upstream unavailable", http.StatusServiceUnavailable)
		case RateLimited:
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":-32005,"message":"project ID request rate exceeded"}}`, id)
		case TooManyResults:
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":-32005,"message":"query returned more than 10000 results"}}`, id)
		case TooManyTopics:
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":-32602,"message":"invalid argument 0: exceed max topics"}}`, id)
		case InternalError:
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":-32603,"message":"Internal error"}}`, id)
		case Pruned:
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":4444,"message":"pruned history unavailable"}}`, id)
		case Stale:
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":%s}`, id, result)
		case Hang:
			select {
			case <-r.Context().Done():
			case <-stop:
			}
		default:
			res, err := anvil.Post(a.URL, "application/json", bytes.NewReader(body))
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			defer res.Body.Close()
			w.WriteHeader(res.StatusCode)
			_, _ = io.Copy(w, res.Body)
		}
	}))
	a.t.Cleanup(func() { close(stop); srv.Close() })
	p.URL = srv.URL
	return p
}

// Fail answers each later request with rule's fault; nil forwards everything again.
func (p *Proxy) Fail(rule func(Call) Fault) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.rule = rule
}

// Stale answers a later single call with rule's result instead of forwarding it, as a lagging node would; a nil
// result forwards the call, batches are always forwarded, and a nil rule stops it.
func (p *Proxy) Stale(rule func(Call) json.RawMessage) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stale = rule
}

func (p *Proxy) Calls() []Call {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]Call(nil), p.calls...)
}
