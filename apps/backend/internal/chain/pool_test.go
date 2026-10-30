package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

func TestFailingEndpointRestsThenComesBack(t *testing.T) {
	a := chaintest.Start(t)
	want := number(t, context.Background(), a.RPC)
	for name, fault := range map[string]chaintest.Fault{"HTTP 429": chaintest.HTTP429, "HTTP 503": chaintest.HTTP503,
		"JSON-RPC -32005": chaintest.RateLimited, "timeout": chaintest.Hang} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			bad := a.Proxy()
			r := newRPCs(t, bad.URL, a.URL, localhost(a.URL))
			r.pool.timeout = 300 * time.Millisecond
			bad.Fail(func(c chaintest.Call) chaintest.Fault {
				if c.Method == "eth_blockNumber" {
					return fault
				}
				return chaintest.Forward
			})
			if got := number(t, ctx, r.Client); got != want {
				t.Fatalf("block %d, want %d", got, want)
			}
			e := r.pool.endpoints[0]
			failures, until := health(r, e)
			if failures != 1 || !until.After(time.Now()) {
				t.Fatalf("failing endpoint: %d failures, rests until %v; want 1 and resting", failures, until)
			}

			calls := len(bad.Calls())
			if got := number(t, ctx, r.Client); got != want || len(bad.Calls()) != calls {
				t.Fatalf("block %d with %d calls to the resting endpoint", got, len(bad.Calls())-calls)
			}

			bad.Fail(nil)
			time.Sleep(time.Until(until))
			r.pool.mu.Lock()
			for _, other := range r.pool.endpoints[1:] {
				other.latency, other.usedAt = time.Minute, time.Now()
			}
			r.pool.mu.Unlock()
			if got := number(t, ctx, r.Client); got != want || len(bad.Calls()) != calls+2 {
				t.Fatalf("after its rest: block %d, %d calls to it; want it used again", got, len(bad.Calls())-calls)
			}
			if failures, _ := health(r, e); failures != 0 {
				t.Fatalf("%d failures after a success, want 0", failures)
			}
		})
	}
}

func TestRefusingEndpointRestsLong(t *testing.T) {
	a := chaintest.Start(t)
	want := number(t, context.Background(), a.RPC)
	for name, answer := range map[string]http.HandlerFunc{
		"HTTP 401": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) },
		"HTTP 403": func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "error code: 1009", http.StatusForbidden) },
		"HTTP 404": func(w http.ResponseWriter, _ *http.Request) { http.NotFound(w, nil) },
		"Brotli": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Encoding", "br")
			_, _ = w.Write([]byte{0x8b, 0x05, 0x80, 0x7b, 0x7d, 0x03})
		},
	} {
		t.Run(name, func(t *testing.T) {
			bad := httptest.NewServer(answer)
			defer bad.Close()
			r := newRPCs(t, bad.URL, a.URL, localhost(a.URL))
			if got := number(t, context.Background(), r.Client); got != want {
				t.Fatalf("block %d, want %d", got, want)
			}
			if failures, until := health(r, r.pool.endpoints[0]); failures != 1 || time.Until(until) < RestMax/2-time.Second {
				t.Fatalf("%d failures, rests %v; want 1 and about half of RestMax or more", failures, time.Until(until))
			}
		})
	}
}

func TestHangingHostRestsWhole(t *testing.T) {
	a := chaintest.Start(t)
	want := number(t, context.Background(), a.RPC)
	hang := a.Proxy()
	hang.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.Hang })
	r := newRPCs(t, hang.URL+"/1", hang.URL+"/2", hang.URL+"/3", a.URL, localhost(a.URL))
	r.pool.timeout = 300 * time.Millisecond
	start := time.Now()
	if got := number(t, context.Background(), r.Client); got != want {
		t.Fatalf("block %d, want %d", got, want)
	}
	if took := time.Since(start); took > 2*r.pool.timeout {
		t.Fatalf("answered after %v, want about one attempt (%v)", took, r.pool.timeout)
	}
	for _, e := range r.pool.endpoints[:3] {
		if failures, until := health(r, e); failures != 1 || !until.After(time.Now()) {
			t.Fatalf("%s: %d failures, rests until %v; want the whole host resting", e.name, failures, until)
		}
	}
}

// At 10 calls a second the 5 requests queue on the first endpoint; the burst must count as one failure.
func TestQueuedRequestsSkipAnEndpointThatStartsToRest(t *testing.T) {
	a := chaintest.Start(t)
	bad := a.Proxy()
	r, err := NewRPCs(testSpec(chaintest.ChainID, bad.URL, a.URL, localhost(a.URL)), 10)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	want := number(t, ctx, r.Client)
	bad.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.HTTP429 })
	got := make(chan uint64, 5)
	for range 5 {
		go func() {
			n, _ := tryNumber(ctx, r.Client)
			got <- n
		}()
	}
	for range 5 {
		if n := <-got; n != want {
			t.Fatalf("block %d, want %d", n, want)
		}
	}
	refused := len(bad.Calls()) - answered(bad)
	if failures, _ := health(r, r.pool.endpoints[0]); failures != 1 || refused != 1 {
		t.Fatalf("%d failures from %d refused requests, want 1 and 1", failures, refused)
	}
}

func TestFailoverUsesEveryConfiguredEndpoint(t *testing.T) {
	a := chaintest.Start(t)
	hosts := []*chaintest.Proxy{a.Proxy(), a.Proxy(), a.Proxy()}
	r := newRPCs(t, hosts[0].URL, hosts[1].URL, hosts[2].URL)
	for i, host := range hosts {
		before := answered(host)
		number(t, t.Context(), r.Client)
		if answered(host) <= before {
			t.Fatalf("endpoint %d did not serve after earlier endpoints failed", i)
		}
		host.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.HTTP503 })
	}
}

func TestFailedKeyMovesToTheNextKeyOnItsHost(t *testing.T) {
	a := chaintest.Start(t)
	infura, other := a.Proxy(), a.Proxy()
	r := newRPCs(t, infura.URL+"/v3/key1", infura.URL+"/v3/key2", other.URL)
	infura.Fail(func(c chaintest.Call) chaintest.Fault {
		if c.Path == "/v3/key1" {
			return chaintest.HTTP429
		}
		return chaintest.Forward
	})
	ctx := context.Background()
	number(t, ctx, r.Client)
	key2 := 0
	for _, c := range infura.Calls() {
		if c.Path == "/v3/key2" && c.Fault == chaintest.Forward {
			key2++
		}
	}
	if key2 == 0 || answered(other) != 0 {
		t.Fatalf("key2 answered %d calls, the other host %d; want key2 used before the next host", key2, answered(other))
	}
	if _, until := health(r, r.pool.endpoints[1]); until.After(time.Now()) {
		t.Fatal("key1's rate limit rested key2")
	}
	if failures, _ := health(r, r.pool.endpoints[0]); failures != 1 {
		t.Fatalf("key1 has %d failures, want 1", failures)
	}
}

func TestURLsStayOutOfErrorsAndLogs(t *testing.T) {
	var logs bytes.Buffer
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))

	a := chaintest.Start(t)
	hung, limited := a.Proxy(), a.Proxy()
	hung.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.Hang })
	limited.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.HTTP429 })
	r := newRPCs(t, "http://127.0.0.1:1/v3/SECRETKEY1", hung.URL+"/v3/SECRETKEY2", limited.URL+"/v3/SECRETKEY3")
	r.pool.timeout = 200 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, c := range []*rpc.Client{r.Client, r.Client} {
		_, err := tryNumber(ctx, c)
		if err == nil {
			t.Fatal("no error when every endpoint fails")
		}
		if strings.Contains(err.Error(), "SECRETKEY") {
			t.Fatalf("key in error %q", err)
		}
	}
	if !strings.Contains(logs.String(), "rpc-0") || strings.Contains(logs.String(), "SECRETKEY") {
		t.Fatalf("logs must name the endpoints without their keys:\n%s", logs.String())
	}
}

// A batch counts each of its calls against the selected endpoint's pace.
func TestEachEndpointIsPaced(t *testing.T) {
	a := chaintest.Start(t)
	r, err := NewRPCs(testSpec(chaintest.ChainID, a.URL), 20) // 50 ms a call
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	start := time.Now()
	for range 5 {
		number(t, ctx, r.Client)
	}
	if took := time.Since(start); took < 200*time.Millisecond {
		t.Fatalf("5 calls took %v, want at least 200ms at 20 a second", took)
	}

	batch := make([]rpc.BatchElem, 10)
	for i := range batch {
		batch[i] = rpc.BatchElem{Method: "eth_blockNumber", Result: new(string)}
	}
	if err := r.Client.BatchCallContext(ctx, batch); err != nil {
		t.Fatal(err)
	}
	end := time.Now()
	number(t, ctx, r.Client)
	if took := time.Since(end); took < 400*time.Millisecond {
		t.Fatalf("after a batch of 10: next call answered in %v; want about 500ms", took)
	}
}

func TestRestDoublesUpToTheCapWithJitter(t *testing.T) {
	for _, c := range []struct {
		failures int
		jitter   float64
		want     time.Duration
	}{
		{1, 0, 500 * time.Millisecond},
		{1, 0.5, 750 * time.Millisecond},
		{2, 0, time.Second},
		{3, 0.5, 3 * time.Second},
		{9, 0, 128 * time.Second},
		{10, 0, 150 * time.Second}, // 512 s, capped at RestMax
		{10, 0.5, 225 * time.Second},
		{1000, 0, 150 * time.Second},
	} {
		if got := restFor(c.failures, c.jitter); got != c.want {
			t.Errorf("restFor(%d, %v) = %v, want %v", c.failures, c.jitter, got, c.want)
		}
	}
}

func TestOutageIsToldFromAnAnswer(t *testing.T) {
	for _, c := range []struct {
		answer string
		outage bool
	}{
		{`{"jsonrpc":"2.0","id":1,"result":"0x1"}`, false},
		{`{"jsonrpc":"2.0","id":1,"error":{"code":3,"message":"execution reverted"}}`, false},
		{`{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"invalid argument 0: hex string without 0x prefix"}}`, false},
		{`{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"header not found"}}`, false},
		{`{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"query returned more than 10000 results"}}`, false},
		{`{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"exceed maximum block range: 50000"}}`, false},
		{`{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"project ID request rate exceeded"}}`, true},
		{`{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"daily request count exceeded, request rate limited"}}`, true},
		{`{"jsonrpc":"2.0","id":1,"error":{"code":429,"message":"Your app has exceeded its compute units per second capacity"}}`, true},
		{`{"jsonrpc":"2.0","id":1,"error":{"code":-32007,"message":"15/second request limit reached"}}`, true},
		{`{"jsonrpc":"2.0","id":1,"error":{"code":-32016,"message":"over rate limit"}}`, true},
		{`{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Too Many Requests"}}`, true},
		{`[{"jsonrpc":"2.0","id":1,"result":"0x1"},{"jsonrpc":"2.0","id":2,"error":{"code":-32005,"message":"limit exceeded"}}]`, true},
		{`[{"jsonrpc":"2.0","id":1,"result":"0x1"}]`, false},
		{`<html>Bad gateway</html>`, true},
	} {
		if got := outage([]byte(c.answer)) != ""; got != c.outage {
			t.Errorf("outage(%s) = %v, want %v", c.answer, got, c.outage)
		}
	}
}

// Only a refused range or result narrows a log query; a rate limit never does.
func TestTooLarge(t *testing.T) {
	for _, c := range []struct {
		err  error
		want bool
	}{
		{rpc.HTTPError{StatusCode: 429, Status: "429 Too Many Requests"}, false},
		{fmt.Errorf("read logs: %w", rpc.HTTPError{StatusCode: 503}), false},
		{fmt.Errorf("read logs: %w", jsonError{-32005, "query returned more than 10000 results"}), true},
		{jsonError{-32005, "project ID request rate exceeded"}, false},
		{jsonError{-32000, "exceed maximum block range: 50000"}, true},
		{jsonError{-32602, "Log response size exceeded"}, true},
		{jsonError{-32602, "query exceeds max results 20000, retry with the range 1-4500"}, true},
		{jsonError{-32000, "request timed out before a result"}, false},
		{jsonError{-32000, "invalid block size"}, false},
		{jsonError{3, "execution reverted"}, false},
		{errors.New("dial tcp: connection refused"), false},
		{context.DeadlineExceeded, false},
	} {
		if got := TooLarge(c.err); got != c.want {
			t.Errorf("TooLarge(%v) = %v, want %v", c.err, got, c.want)
		}
	}
}

type jsonError struct {
	code int
	msg  string
}

func (e jsonError) Error() string  { return e.msg }
func (e jsonError) ErrorCode() int { return e.code }

func health(r RPCs, e *endpoint) (int, time.Time) {
	r.pool.mu.Lock()
	defer r.pool.mu.Unlock()
	return e.failures, e.restUntil
}

func answered(p *chaintest.Proxy) int {
	n := 0
	for _, c := range p.Calls() {
		if c.Fault == chaintest.Forward {
			n++
		}
	}
	return n
}

// 20 rounds of 10 calls at once should open about 10 connections, not one per call (net/http keeps 2 idle).
func TestCallsReuseConnections(t *testing.T) {
	var conns atomic.Int32
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID json.RawMessage `json:"id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		time.Sleep(5 * time.Millisecond) // calls overlap
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x7a69"}`, req.ID)
	}))
	srv.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			conns.Add(1)
		}
	}
	srv.Start()
	defer srv.Close()
	r := newRPCs(t, srv.URL, localhost(srv.URL))
	ctx := context.Background()
	for range 20 {
		var wg sync.WaitGroup
		for range 10 {
			wg.Go(func() {
				if _, err := tryNumber(ctx, r.Client); err != nil {
					t.Error(err)
				}
			})
		}
		wg.Wait()
	}
	if n := conns.Load(); n > 20 {
		t.Fatalf("%d connections for 200 calls, want them reused", n)
	}
}

func TestOversizedAnswerIsAnOutage(t *testing.T) {
	a := chaintest.Start(t)
	want := number(t, context.Background(), a.RPC)
	huge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chunk := bytes.Repeat([]byte(" "), 1<<20)
		for range maxAnswer>>20 + 1 {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
	}))
	defer huge.Close()
	r := newRPCs(t, huge.URL, a.URL, localhost(a.URL))
	if got := number(t, context.Background(), r.Client); got != want {
		t.Fatalf("block %d, want %d from the next endpoint", got, want)
	}
	if failures, _ := health(r, r.pool.endpoints[0]); failures != 1 {
		t.Fatalf("oversized endpoint: %d failures, want 1", failures)
	}
}

func TestCallerDeadlineDoesNotRestProviderForOtherWork(t *testing.T) {
	a := chaintest.Start(t)
	proxy := a.Proxy()
	r := newRPCs(t, proxy.URL)
	if _, err := tryNumber(t.Context(), r.Client); err != nil {
		t.Fatal(err)
	}
	proxy.Fail(func(call chaintest.Call) chaintest.Fault { return chaintest.Hang })
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	if _, err := tryNumber(ctx, r.Client); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("caller deadline: %v", err)
	}
	if failures, _ := health(r, r.pool.endpoints[0]); failures != 0 {
		t.Fatalf("caller deadline rested provider used by other work: %d failures", failures)
	}
	proxy.Fail(nil)
	if _, err := tryNumber(t.Context(), r.Client); err != nil {
		t.Fatalf("healthy provider remained unavailable: %v", err)
	}
}

func TestRequestsThatCannotMeetTheirDeadlineDoNotDelayLaterReads(t *testing.T) {
	a := chaintest.Start(t)
	proxy := a.Proxy()
	r, err := NewRPCs(testSpec(chaintest.ChainID, proxy.URL), 10)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	r.pool.mu.Lock()
	r.pool.endpoints[0].next = time.Now().Add(200 * time.Millisecond)
	r.pool.mu.Unlock()
	for range 20 {
		ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
		_, err := tryNumber(ctx, r.Client)
		cancel()
		if err == nil {
			t.Fatal("request was sent before its pacing slot")
		}
	}
	if got := len(proxy.Calls()); got != 0 {
		t.Fatalf("rejected requests reached the blockchain provider: %d calls", got)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	if _, err := tryNumber(ctx, r.Client); err != nil {
		t.Fatalf("rejected requests consumed future capacity and blocked a later read: %v", err)
	}
}

func TestHTTPLogRangeErrorsDoNotRestProvider(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusRequestEntityTooLarge} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var request struct {
					ID     json.RawMessage
					Method string
				}
				_ = json.NewDecoder(r.Body).Decode(&request)
				if request.Method == "eth_chainId" {
					fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x7a69"}`, request.ID)
					return
				}
				w.WriteHeader(status)
				fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":35,"message":"ranges over 10000 blocks are not supported on free plan"}}`, request.ID)
			}))
			defer server.Close()
			r := newRPCs(t, server.URL, localhost(server.URL))
			ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
			defer cancel()
			var result any
			err := r.Client.CallContext(ctx, &result, "eth_getLogs", map[string]string{"fromBlock": "0x1", "toBlock": "0x100"})
			if !TooLarge(err) {
				t.Fatalf("range error cannot be narrowed: %v", err)
			}
			if calls.Load() != 4 {
				t.Fatalf("each endpoint asked for its chain ID and the range once; got %d calls", calls.Load())
			}
			for _, e := range r.pool.endpoints {
				if failures, _ := health(r, e); failures != 0 {
					t.Fatalf("range error rested healthy provider: failures=%d", failures)
				}
			}
		})
	}
}

func TestHTTPBatchLimitDoesNotRestProvider(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request struct {
			ID     json.RawMessage
			Method string
		}
		body, _ := io.ReadAll(r.Body)
		if json.Unmarshal(body, &request) == nil && request.Method == "eth_chainId" {
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x7a69"}`, request.ID)
			return
		}
		w.WriteHeader(500)
		fmt.Fprint(w, `[{"jsonrpc":"2.0","id":1,"error":{"code":31,"message":"Batch of more than 3 requests are not allowed on free plan"}}]`)
	}))
	defer server.Close()
	r := newRPCs(t, server.URL, localhost(server.URL))
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	var result any
	err := r.Client.BatchCallContext(ctx, []rpc.BatchElem{{Method: "eth_blockNumber", Result: &result}})
	if !BatchTooLarge(err) {
		t.Fatalf("batch limit cannot be split: %v", err)
	}
	if calls.Load() != 4 {
		t.Fatalf("expected one failed batch per endpoint, got %d calls", calls.Load())
	}
	for _, e := range r.pool.endpoints {
		if failures, _ := health(r, e); failures != 0 {
			t.Fatalf("batch limit rested provider: %d", failures)
		}
	}
}

// rpcServer answers eth_chainId for the test chain; answer handles every other call.
func rpcServer(t *testing.T, answer func(w http.ResponseWriter, id json.RawMessage, method string, params []json.RawMessage)) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			ID     json.RawMessage
			Method string
			Params []json.RawMessage
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request.Method == "eth_chainId" {
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x7a69"}`, request.ID)
			return
		}
		calls.Add(1)
		answer(w, request.ID, request.Method, request.Params)
	}))
	t.Cleanup(server.Close)
	return server, &calls
}

func getLogs(ctx context.Context, c *rpc.Client, from, to uint64) error {
	var logs []any
	return c.CallContext(ctx, &logs, "eth_getLogs", map[string]string{"fromBlock": fmt.Sprintf("0x%x", from), "toBlock": fmt.Sprintf("0x%x", to)})
}

func TestRangeOneEndpointRefusesGoesToTheNext(t *testing.T) {
	limited, limitedCalls := rpcServer(t, func(w http.ResponseWriter, id json.RawMessage, _ string, params []json.RawMessage) {
		var filter struct{ FromBlock, ToBlock hexutil.Uint64 }
		_ = json.Unmarshal(params[0], &filter)
		if filter.ToBlock-filter.FromBlock >= 100 {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":35,"message":"ranges over 10000 blocks are not supported on free plan"}}`, id)
			return
		}
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":[]}`, id)
	})
	full, fullCalls := rpcServer(t, func(w http.ResponseWriter, id json.RawMessage, _ string, _ []json.RawMessage) {
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":[]}`, id)
	})
	r := newRPCs(t, limited.URL, localhost(full.URL)) // the limited one comes first in the configured order
	for i := range 3 {
		if err := getLogs(t.Context(), r.Client, 1, 2000); err != nil {
			t.Fatalf("query %d: %v; want the endpoint that takes 2,000 blocks to answer", i, err)
		}
	}
	if limitedCalls.Load() != 1 || fullCalls.Load() != 3 {
		t.Fatalf("limited endpoint asked %d times, full one %d; want the refusal remembered", limitedCalls.Load(), fullCalls.Load())
	}
	for _, e := range r.pool.endpoints {
		if failures, _ := health(r, e); failures != 0 {
			t.Fatalf("a refused size rested %s", e.name)
		}
	}
}

func TestAddressLimitIsNotARateLimit(t *testing.T) {
	for m, want := range map[string]bool{
		"a maximum of 10 addresses is allowed. no limit on a dedicated node": true,
		"too many addresses":                          true,
		"rate limit exceeded for your ip address":     false,
		"query exceeds max results 20000 for address": false,
		"invalid address":                             false,
	} {
		if got := addressLimit(m); got != want {
			t.Errorf("addressLimit(%q) = %v, want %v", m, got, want)
		}
	}
}

func TestBatchTooLarge(t *testing.T) {
	for _, c := range []struct {
		message string
		want    bool
	}{
		{"Batch of more than 3 requests are not allowed on free plan", true},
		{"batch size 101 exceeds limit of 100", true},
		{"batch too large", true},
		{"batch rate limit exceeded", false},
		{"request too large", false},
	} {
		if got := BatchTooLarge(jsonError{-32600, c.message}); got != c.want {
			t.Errorf("BatchTooLarge(%q) = %v, want %v", c.message, got, c.want)
		}
	}
}

func TestMissingBlockGoesToAnEndpointThatHasIt(t *testing.T) {
	lagging, laggingCalls := rpcServer(t, func(w http.ResponseWriter, id json.RawMessage, _ string, _ []json.RawMessage) {
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":-32000,"message":"historical state not available in path scheme"}}`, id)
	})
	full, fullCalls := rpcServer(t, func(w http.ResponseWriter, id json.RawMessage, _ string, _ []json.RawMessage) {
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x01"}`, id)
	})
	r := newRPCs(t, lagging.URL, localhost(full.URL)) // the lagging one comes first in the configured order
	var out string
	if err := r.Client.CallContext(t.Context(), &out, "eth_call", map[string]string{}, "0x10"); err != nil || out != "0x01" {
		t.Fatalf("got %q %v; want the endpoint that has the state to answer", out, err)
	}
	if laggingCalls.Load() != 1 || fullCalls.Load() != 1 {
		t.Fatalf("lagging asked %d times, full %d", laggingCalls.Load(), fullCalls.Load())
	}
	if failures, until := health(r, r.pool.endpoints[0]); failures != 0 || until.After(time.Now()) {
		t.Fatalf("a miss rested the lagging endpoint: %d failures", failures)
	}
	full.Close()
	err := r.Client.CallContext(t.Context(), &out, "eth_call", map[string]string{}, "0x10")
	if err == nil || Missing(err) || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("one endpoint misses and the other is down: %v, want unavailable, since the down one may hold it", err)
	}
	lagging2, _ := rpcServer(t, func(w http.ResponseWriter, id json.RawMessage, _ string, _ []json.RawMessage) {
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":4444,"message":"pruned history unavailable"}}`, id)
	})
	both := newRPCs(t, lagging.URL, localhost(lagging2.URL))
	if err := both.Client.CallContext(t.Context(), &out, "eth_call", map[string]string{}, "0x10"); !Missing(err) {
		t.Fatalf("every endpoint misses: %v, want the miss", err)
	}
}

// A node that can't give its finalized block fails its health check and rests, like any failed one.
func TestHealthCheckMissingTheFinalizedBlockRestsTheEndpoint(t *testing.T) {
	broken, _ := rpcServer(t, func(w http.ResponseWriter, id json.RawMessage, method string, _ []json.RawMessage) {
		if method == "eth_getBlockByNumber" {
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":-32000,"message":"finalized block not found"}}`, id)
			return
		}
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x10"}`, id)
	})
	r := newRPCs(t, broken.URL)
	r.pool.maxHeadAge = time.Minute
	if _, err := tryNumber(t.Context(), r.Client); err == nil || strings.Contains(err.Error(), missing) {
		t.Fatalf("got %v; want the endpoint unavailable, not its health check's answer", err)
	}
	if failures, until := health(r, r.pool.endpoints[0]); failures != 1 || !until.After(time.Now()) {
		t.Fatalf("%d failures; want the endpoint resting", failures)
	}
}

func TestRevertReasonKeepsItsCategory(t *testing.T) {
	for _, m := range []string{"execution reverted: pruned", "execution reverted: batch exceeds limit", "execution reverted: block not found"} {
		if got := safeMessage(3, m); got != "execution reverted" {
			t.Errorf("safeMessage(%q) = %q", m, got)
		}
	}
}

func TestSignedTransactionAlsoGoesToAnotherHost(t *testing.T) {
	sends := map[string]*atomic.Int32{}
	reads := map[string]*atomic.Int32{}
	server := func(name string) *httptest.Server {
		sends[name], reads[name] = new(atomic.Int32), new(atomic.Int32)
		s, _ := rpcServer(t, func(w http.ResponseWriter, id json.RawMessage, method string, _ []json.RawMessage) {
			if method == "eth_sendRawTransaction" {
				sends[name].Add(1)
				fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x%s"}`, id, strings.Repeat("ab", 32))
				return
			}
			reads[name].Add(1)
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x10"}`, id)
		})
		return s
	}
	a, b := server("a"), server("b")
	r := newRPCs(t, a.URL, a.URL+"/twin", localhost(b.URL)) // the twin shares a's host, so it must not get the copy
	var hash string
	if err := r.Client.CallContext(t.Context(), &hash, "eth_sendRawTransaction", "0x01"); err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(2 * time.Second); sends["a"].Load()+sends["b"].Load() < 2; time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("signed transaction reached %d and %d endpoints; want both hosts", sends["a"].Load(), sends["b"].Load())
		}
	}
	if sends["a"].Load() != 1 || sends["b"].Load() != 1 {
		t.Fatalf("sent %d and %d times; want once to each host", sends["a"].Load(), sends["b"].Load())
	}
	number(t, t.Context(), r.Client)
	time.Sleep(100 * time.Millisecond)
	if n := reads["a"].Load() + reads["b"].Load(); n != 1 {
		t.Fatalf("a read went to %d endpoints, want 1", n)
	}
}

func TestSecondSendNeverDelaysTheCaller(t *testing.T) {
	answering, _ := rpcServer(t, func(w http.ResponseWriter, id json.RawMessage, _ string, _ []json.RawMessage) {
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x%s"}`, id, strings.Repeat("ab", 32))
	})
	release := make(chan struct{})
	hanging := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(hanging.Close)
	t.Cleanup(func() { close(release) }) // runs first, so Close never waits on a hung handler
	r := newRPCs(t, answering.URL, localhost(hanging.URL))
	began := time.Now()
	var hash string
	if err := r.Client.CallContext(t.Context(), &hash, "eth_sendRawTransaction", "0x01"); err != nil {
		t.Fatal(err)
	}
	if took := time.Since(began); took > time.Second {
		t.Fatalf("the caller waited %v for the second send", took)
	}
}

// PublicNode answers a log query naming more than 10 contracts with HTTP 403: the query goes on, the endpoint stays healthy.
func TestAddressLimitGoesToTheNextEndpoint(t *testing.T) {
	limited, limitedCalls := rpcServer(t, func(w http.ResponseWriter, id json.RawMessage, _ string, params []json.RawMessage) {
		var filter struct{ Address []string }
		_ = json.Unmarshal(params[0], &filter)
		if len(filter.Address) > 10 {
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprintf(w, `{"jsonrpc":"2.0","error":{"code":-32602,"message":"A maximum of 10 addresses is allowed. No limit on a dedicated node"},"id":%s}`, id)
			return
		}
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":[]}`, id)
	})
	full, fullCalls := rpcServer(t, func(w http.ResponseWriter, id json.RawMessage, _ string, _ []json.RawMessage) {
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":[]}`, id)
	})
	r := newRPCs(t, limited.URL, localhost(full.URL)) // the limited one comes first in the configured order
	addresses := make([]string, 22)
	for i := range addresses {
		addresses[i] = fmt.Sprintf("0x%040x", i+1)
	}
	for i := range 3 {
		var logs []any
		if err := r.Client.CallContext(t.Context(), &logs, "eth_getLogs", map[string]any{"fromBlock": "0x1", "toBlock": "0x2", "address": addresses}); err != nil {
			t.Fatalf("query %d: %v; want the endpoint that takes 22 addresses to answer", i, err)
		}
	}
	if limitedCalls.Load() != 1 || fullCalls.Load() != 3 {
		t.Fatalf("limited endpoint asked %d times, full one %d; want the refusal remembered", limitedCalls.Load(), fullCalls.Load())
	}
	if failures, until := health(r, r.pool.endpoints[0]); failures != 0 || until.After(time.Now()) {
		t.Fatalf("an address refusal rested the endpoint: %d failures", failures)
	}
	now := time.Now()
	if e := r.pool.endpoints[0]; e.refuses(request{addresses: 5}, now) || !e.refuses(request{addresses: 22}, now) {
		t.Fatal("want the endpoint asked last only for lists as long as the one it refused")
	}
}

func TestFasterEndpointIsPreferredOverTheConfiguredOrder(t *testing.T) {
	answer := func(delay time.Duration) func(http.ResponseWriter, json.RawMessage, string, []json.RawMessage) {
		return func(w http.ResponseWriter, id json.RawMessage, _ string, _ []json.RawMessage) {
			time.Sleep(delay)
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x10"}`, id)
		}
	}
	slow, slowCalls := rpcServer(t, answer(80*time.Millisecond))
	fast, fastCalls := rpcServer(t, answer(0))
	r := newRPCs(t, slow.URL, localhost(fast.URL))
	for range 12 {
		number(t, t.Context(), r.Client)
	}
	if slowCalls.Load() > 2 || fastCalls.Load() < 10 {
		t.Fatalf("slow endpoint answered %d calls, fast one %d; want the fast one used once both are measured",
			slowCalls.Load(), fastCalls.Load())
	}
}

func TestBatchOneEndpointRefusesGoesToTheNext(t *testing.T) {
	batchServer := func(limit int) (*httptest.Server, *atomic.Int32) {
		var batches atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			var calls []struct{ ID json.RawMessage }
			if json.Unmarshal(body, &calls) != nil {
				var one struct{ ID json.RawMessage }
				_ = json.Unmarshal(body, &one)
				fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x7a69"}`, one.ID) // the health probe's eth_chainId
				return
			}
			batches.Add(1)
			if len(calls) > limit {
				w.WriteHeader(http.StatusInternalServerError)
				fmt.Fprint(w, `[{"jsonrpc":"2.0","id":1,"error":{"code":31,"message":"Batch of more than 3 requests are not allowed on free plan"}}]`)
				return
			}
			answers := make([]string, len(calls))
			for i, c := range calls {
				answers[i] = fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":"0x10"}`, c.ID)
			}
			fmt.Fprint(w, "["+strings.Join(answers, ",")+"]")
		}))
		t.Cleanup(server.Close)
		return server, &batches
	}
	limited, limitedBatches := batchServer(3)
	full, fullBatches := batchServer(100)
	r := newRPCs(t, limited.URL, localhost(full.URL))
	for i := range 2 {
		batch := make([]rpc.BatchElem, 5)
		for j := range batch {
			batch[j] = rpc.BatchElem{Method: "eth_blockNumber", Result: new(string)}
		}
		if err := r.Client.BatchCallContext(t.Context(), batch); err != nil || batch[0].Error != nil {
			t.Fatalf("batch %d: %v %v; want the endpoint that takes 5 calls to answer", i, err, batch[0].Error)
		}
	}
	if limitedBatches.Load() != 1 || fullBatches.Load() != 2 {
		t.Fatalf("limited endpoint got %d batches, full one %d; want the refusal remembered", limitedBatches.Load(), fullBatches.Load())
	}
}
