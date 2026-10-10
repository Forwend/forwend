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
	Params       []json.RawMessage
	Fault        Fault
}

// Fault is how a Proxy answers a request instead of forwarding it to Anvil.
type Fault int

const (
	Forward        Fault = iota
	HTTP429              // HTTP 429 Too Many Requests
	HTTP503              // HTTP 503 Service Unavailable
	RateLimited          // JSON-RPC error -32005 "project ID request rate exceeded", as Infura answers over its rate
	TooManyResults       // JSON-RPC error -32005 "query returned more than 10000 results", as Infura answers a big log query
	Hang                 // no answer until the client gives up
)

// Proxy is a JSON-RPC proxy in front of Anvil that answers each request with the fault its rule picks.
type Proxy struct {
	URL string

	mu    sync.Mutex
	rule  func(Call) Fault
	calls []Call
}

// Proxy starts a proxy in front of this Anvil until the test ends. It forwards every request until Fail sets a rule.
func (a *Anvil) Proxy() *Proxy {
	p := &Proxy{}
	stop := make(chan struct{})
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
		}
		p.mu.Lock()
		if p.rule != nil {
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
		case Hang:
			select {
			case <-r.Context().Done():
			case <-stop:
			}
		default:
			res, err := http.Post(a.URL, "application/json", bytes.NewReader(body))
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

// Calls returns every request received so far, in order.
func (p *Proxy) Calls() []Call {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]Call(nil), p.calls...)
}
