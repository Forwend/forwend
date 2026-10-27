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
			if got := number(t, ctx, r.Primary); got != want {
				t.Fatalf("block %d, want %d", got, want)
			}
			e := r.pool.endpoints[0]
			failures, until := health(r, e)
			if failures != 1 || !until.After(time.Now()) {
				t.Fatalf("failing endpoint: %d failures, rests until %v; want 1 and resting", failures, until)
			}

			calls := len(bad.Calls())
			if got := number(t, ctx, r.Primary); got != want || len(bad.Calls()) != calls {
				t.Fatalf("block %d with %d calls to the resting endpoint", got, len(bad.Calls())-calls)
			}

			bad.Fail(nil)
			time.Sleep(time.Until(until))
			if got := number(t, ctx, r.Primary); got != want || len(bad.Calls()) != calls+2 {
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
			if got := number(t, context.Background(), r.Primary); got != want {
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
	if got := number(t, context.Background(), r.Primary); got != want {
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
	want := number(t, ctx, r.Primary)
	bad.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.HTTP429 })
	got := make(chan uint64, 5)
	for range 5 {
		go func() {
			n, _ := tryNumber(ctx, r.Primary)
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

// D-15: a failed host is replaced only by another of its own role.
func TestRolesStayOnDifferentHosts(t *testing.T) {
	a := chaintest.Start(t)
	hosts := []*chaintest.Proxy{a.Proxy(), a.Proxy(), a.Proxy()}
	r := newRPCs(t, hosts[0].URL, hosts[1].URL, hosts[2].URL)
	ctx := context.Background()
	served := func(ctx context.Context, c *rpc.Client) (int, error) {
		before := make([]int, len(hosts))
		for i, h := range hosts {
			before[i] = answered(h)
		}
		_, err := tryNumber(ctx, c)
		for i, h := range hosts {
			if answered(h) > before[i] {
				return i, err
			}
		}
		return -1, err
	}
	expect := func(primary, second int) {
		t.Helper()
		if got, err := served(ctx, r.Primary); err != nil || got != primary {
			t.Fatalf("primary served by host %d (%v), want %d", got, err, primary)
		}
		if got, err := served(ctx, r.Second); err != nil || got != second {
			t.Fatalf("second served by host %d (%v), want %d", got, err, second)
		}
	}
	down := func(chaintest.Call) chaintest.Fault { return chaintest.HTTP503 }

	expect(0, 1)
	// The second's only host is down: balances wait rather than move to a host the primary may use.
	hosts[1].Fail(down)
	short, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
	defer cancel()
	if got, err := served(short, r.Second); err == nil || got != -1 {
		t.Fatalf("second served by host %d (%v) while its own host is down; want an error", got, err)
	}
	hosts[1].Fail(nil)

	// SEC-01: after the primary fails over and back, the second never reads from the host the primary used meanwhile.
	hosts[0].Fail(down)
	if got, err := served(ctx, r.Primary); err != nil || got != 2 {
		t.Fatalf("primary served by host %d (%v), want 2", got, err)
	}
	hosts[0].Fail(nil)
	for _, e := range r.pool.endpoints[:2] {
		_, until := health(r, e)
		time.Sleep(time.Until(until))
	}
	expect(0, 1)
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
	number(t, ctx, r.Primary)
	beforeOther := answered(other)
	number(t, ctx, r.Second)
	key2 := 0
	for _, c := range infura.Calls() {
		if c.Path == "/v3/key2" && c.Fault == chaintest.Forward {
			key2++
		}
	}
	if key2 == 0 || answered(other) == beforeOther {
		t.Fatalf("key2 answered %d calls, the other host %d; want the primary on key2 and the second on the other host",
			key2, answered(other)-beforeOther)
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
	for _, c := range []*rpc.Client{r.Primary, r.Second} {
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

// A batch counts each of its calls; the other host's pace is its own.
func TestEachEndpointIsPaced(t *testing.T) {
	a := chaintest.Start(t)
	r, err := NewRPCs(testSpec(chaintest.ChainID, a.URL, localhost(a.URL)), 20) // 50 ms a call
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	start := time.Now()
	for range 5 {
		number(t, ctx, r.Primary)
	}
	if took := time.Since(start); took < 200*time.Millisecond {
		t.Fatalf("5 calls took %v, want at least 200ms at 20 a second", took)
	}

	batch := make([]rpc.BatchElem, 10)
	for i := range batch {
		batch[i] = rpc.BatchElem{Method: "eth_blockNumber", Result: new(string)}
	}
	if err := r.Primary.BatchCallContext(ctx, batch); err != nil {
		t.Fatal(err)
	}
	end := time.Now()
	number(t, ctx, r.Second)
	second := time.Since(end)
	number(t, ctx, r.Primary)
	if primary := time.Since(end); second > 250*time.Millisecond || primary < 400*time.Millisecond {
		t.Fatalf("after a batch of 10: second answered in %v, primary in %v; want the primary to wait about 500ms "+
			"and the second not", second, primary)
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

func TestOverloaded(t *testing.T) {
	for _, c := range []struct {
		err  error
		want bool
	}{
		{rpc.HTTPError{StatusCode: 429, Status: "429 Too Many Requests"}, true},
		{fmt.Errorf("read logs: %w", rpc.HTTPError{StatusCode: 503}), false},
		{fmt.Errorf("read logs: %w", jsonError{-32005, "query returned more than 10000 results"}), true},
		{jsonError{-32005, "project ID request rate exceeded"}, true},
		{jsonError{-32000, "exceed maximum block range: 50000"}, true},
		{jsonError{-32602, "Log response size exceeded"}, true},
		{jsonError{3, "execution reverted"}, false},
		{errors.New("dial tcp: connection refused"), false},
		{context.DeadlineExceeded, false},
	} {
		if got := Overloaded(c.err); got != c.want {
			t.Errorf("Overloaded(%v) = %v, want %v", c.err, got, c.want)
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
				if _, err := tryNumber(ctx, r.Primary); err != nil {
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
	if got := number(t, context.Background(), r.Primary); got != want {
		t.Fatalf("block %d, want %d from the next endpoint", got, want)
	}
	if failures, _ := health(r, r.pool.endpoints[0]); failures != 1 {
		t.Fatalf("oversized endpoint: %d failures, want 1", failures)
	}
}

func TestRequestsThatCannotMeetTheirDeadlineDoNotDelayLaterReads(t *testing.T) {
	a := chaintest.Start(t)
	proxy := a.Proxy()
	r, err := NewRPCs(testSpec(chaintest.ChainID, proxy.URL, localhost(a.URL)), 10)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	r.pool.mu.Lock()
	r.pool.endpoints[0].next = time.Now().Add(200 * time.Millisecond)
	r.pool.mu.Unlock()
	for range 20 {
		ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
		_, err := tryNumber(ctx, r.Primary)
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
	if _, err := tryNumber(ctx, r.Primary); err != nil {
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
			err := r.Primary.CallContext(ctx, &result, "eth_getLogs", map[string]string{"fromBlock": "0x1", "toBlock": "0x100"})
			if !TooLarge(err) {
				t.Fatalf("range error cannot be narrowed: %v", err)
			}
			if calls.Load() != 2 {
				t.Fatalf("chain ID plus one request expected; got %d", calls.Load())
			}
			if failures, _ := health(r, r.pool.endpoints[0]); failures != 0 {
				t.Fatalf("range error rested healthy provider: failures=%d", failures)
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
	err := r.Primary.BatchCallContext(ctx, []rpc.BatchElem{{Method: "eth_blockNumber", Result: &result}})
	if !BatchTooLarge(err) {
		t.Fatalf("batch limit cannot be split: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected one failed batch, got %d calls", calls.Load())
	}
	if failures, _ := health(r, r.pool.endpoints[0]); failures != 0 {
		t.Fatalf("batch limit rested provider: %d", failures)
	}
}
