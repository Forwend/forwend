package chain

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/rpc"
	"github.com/gorilla/websocket"
)

// socketServer serves JSON-RPC over WebSocket and over HTTP on one host. answer gets each call other than eth_chainId
// and returns its result as JSON, or "" for no answer at all.
type socketServer struct {
	*httptest.Server
	upgrades atomic.Int32
	answer   func(method string, overSocket bool) string
	mu       sync.Mutex
	conns    []*websocket.Conn
}

// drop closes every WebSocket connection, as a provider dropping idle ones does.
func (s *socketServer) drop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.conns {
		c.Close()
	}
}

func newSocketServer(t *testing.T, answer func(method string, overSocket bool) string) *socketServer {
	t.Helper()
	s := &socketServer{answer: answer}
	upgrader := websocket.Upgrader{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !websocket.IsWebSocketUpgrade(r) {
			var body json.RawMessage
			_ = json.NewDecoder(r.Body).Decode(&body)
			w.Write(s.reply(body, false))
			return
		}
		s.upgrades.Add(1)
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		s.mu.Lock()
		s.conns = append(s.conns, conn)
		s.mu.Unlock()
		var write sync.Mutex
		for {
			_, body, err := conn.ReadMessage()
			if err != nil {
				return
			}
			go func() { // answer out of order, as a provider may
				if out := s.reply(body, true); out != nil {
					write.Lock()
					conn.WriteMessage(websocket.TextMessage, out)
					write.Unlock()
				}
			}()
		}
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *socketServer) reply(body []byte, overSocket bool) []byte {
	calls, batch, err := messages(body)
	if err != nil {
		return nil
	}
	var answers []string
	for _, c := range calls {
		var method string
		_ = json.Unmarshal(c["method"], &method)
		result := `"0x7a69"`
		if method != "eth_chainId" {
			if result = s.answer(method, overSocket); result == "" {
				return nil
			}
		}
		answers = append(answers, fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":%s}`, c["id"], result))
	}
	if batch {
		return []byte("[" + strings.Join(answers, ",") + "]")
	}
	return []byte(answers[0])
}

func (s *socketServer) ws() string { return "ws" + strings.TrimPrefix(s.URL, "http") }

func TestSocketEndpointMatchesConcurrentAnswersToTheirCalls(t *testing.T) {
	s := newSocketServer(t, func(string, bool) string { return `"0x10"` })
	r := newRPCs(t, s.ws())
	var callers sync.WaitGroup
	errs := make(chan error, 40)
	for range 20 {
		callers.Go(func() {
			if n, err := tryNumber(t.Context(), r.Client); err != nil || n != 16 {
				errs <- fmt.Errorf("call: %d %v", n, err)
			}
			batch := make([]rpc.BatchElem, 5)
			for i := range batch {
				batch[i] = rpc.BatchElem{Method: "eth_blockNumber", Result: new(string)}
			}
			if err := r.Client.BatchCallContext(t.Context(), batch); err != nil || batch[4].Error != nil || *batch[4].Result.(*string) != "0x10" {
				errs <- fmt.Errorf("batch: %v %v", err, batch[4].Error)
			}
		})
	}
	callers.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if n := s.upgrades.Load(); n != 1 {
		t.Fatalf("%d connections, want one shared by every call", n)
	}
}

// PublicNode answers one WebSocket batch over several frames.
func TestSocketBatchAnsweredOverSeveralFramesIsWhole(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			_, body, err := conn.ReadMessage()
			if err != nil {
				return
			}
			calls, batch, _ := messages(body)
			if !batch {
				conn.WriteMessage(websocket.TextMessage, fmt.Appendf(nil, `{"jsonrpc":"2.0","id":%s,"result":"0x7a69"}`, calls[0]["id"]))
				continue
			}
			for i := len(calls) - 1; i >= 0; i-- {
				conn.WriteMessage(websocket.TextMessage, fmt.Appendf(nil, `[{"jsonrpc":"2.0","id":%s,"result":"0x%x"}]`, calls[i]["id"], i))
			}
		}
	}))
	t.Cleanup(server.Close)
	r := newRPCs(t, "ws"+strings.TrimPrefix(server.URL, "http"))
	batch := make([]rpc.BatchElem, 5)
	for i := range batch {
		batch[i] = rpc.BatchElem{Method: "eth_blockNumber", Result: new(string)}
	}
	if err := r.Client.BatchCallContext(t.Context(), batch); err != nil {
		t.Fatal(err)
	}
	for i, b := range batch {
		if b.Error != nil || *b.Result.(*string) != fmt.Sprintf("0x%x", i) {
			t.Fatalf("call %d: %v %v", i, *b.Result.(*string), b.Error)
		}
	}
}

func TestSocketEndpointRedialsAfterTheServerDropsIt(t *testing.T) {
	s := newSocketServer(t, func(string, bool) string { return `"0x10"` })
	r := newRPCs(t, s.ws())
	number(t, t.Context(), r.Client)
	s.drop()
	time.Sleep(50 * time.Millisecond) // the reader sees the close
	if n := number(t, t.Context(), r.Client); n != 16 {
		t.Fatalf("block %d after a dropped connection", n)
	}
	if failures, _ := health(r, r.pool.endpoints[0]); failures != 0 || s.upgrades.Load() != 2 {
		t.Fatalf("%d failures, %d connections; want a quiet redial", failures, s.upgrades.Load())
	}
}

func TestSilentSocketFailsOverWithoutRestingItsHTTPSTwin(t *testing.T) {
	s := newSocketServer(t, func(_ string, overSocket bool) string {
		if overSocket {
			return ""
		}
		return `"0x10"`
	})
	r := newRPCs(t, s.ws(), s.URL) // one host, so a host-wide rest would catch the twin
	r.pool.timeout = 300 * time.Millisecond
	socket, twin := r.pool.endpoints[0], r.pool.endpoints[1]
	r.pool.mu.Lock()
	twin.latency, twin.usedAt = time.Second, time.Now() // the socket is tried first
	r.pool.mu.Unlock()
	if n := number(t, t.Context(), r.Client); n != 16 {
		t.Fatalf("block %d", n)
	}
	if failures, _ := health(r, socket); failures != 1 {
		t.Fatalf("silent socket: %d failures, want 1", failures)
	}
	if failures, until := health(r, twin); failures != 0 || until.After(time.Now()) {
		t.Fatalf("the HTTPS twin rests with the silent socket: %d failures", failures)
	}
}

func TestLargeBatchSkipsSocketEndpoints(t *testing.T) {
	s := newSocketServer(t, func(string, bool) string { return `"0x10"` })
	r := newRPCs(t, s.ws(), localhost(s.URL))
	r.pool.mu.Lock()
	r.pool.endpoints[1].latency, r.pool.endpoints[1].usedAt = time.Second, time.Now()
	r.pool.mu.Unlock()
	batch := make([]rpc.BatchElem, socketBatch+1)
	for i := range batch {
		batch[i] = rpc.BatchElem{Method: "eth_blockNumber", Result: new(string)}
	}
	if err := r.Client.BatchCallContext(t.Context(), batch); err != nil {
		t.Fatal(err)
	}
	if n := s.upgrades.Load(); n != 0 {
		t.Fatalf("a batch of %d went over WebSocket (%d connections)", len(batch), n)
	}
}

func TestRefusedUpgradeRestsTheSocketEndpointLong(t *testing.T) {
	refused := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(refused.Close)
	s := newSocketServer(t, func(string, bool) string { return `"0x10"` })
	r := newRPCs(t, "ws"+strings.TrimPrefix(refused.URL, "http"), localhost(s.URL))
	r.pool.mu.Lock()
	r.pool.endpoints[1].latency, r.pool.endpoints[1].usedAt = time.Second, time.Now()
	r.pool.mu.Unlock()
	if n := number(t, t.Context(), r.Client); n != 16 {
		t.Fatalf("block %d", n)
	}
	if _, until := health(r, r.pool.endpoints[0]); time.Until(until) < RestMax/2 {
		t.Fatalf("an upgrade refused with 403 rests until %v, want about %v", until, RestMax)
	}
}

func TestIDLessBatchRefusalOverSocketIsABatchLimit(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			_, body, err := conn.ReadMessage()
			if err != nil {
				return
			}
			calls, batch, _ := messages(body)
			out := fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":"0x7a69"}`, calls[0]["id"])
			if batch {
				out = `{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"batch size 4 exceeds limit of 3"}}`
			}
			conn.WriteMessage(websocket.TextMessage, []byte(out))
		}
	}))
	t.Cleanup(server.Close)
	r := newRPCs(t, "ws"+strings.TrimPrefix(server.URL, "http"))
	batch := make([]rpc.BatchElem, 4)
	for i := range batch {
		batch[i] = rpc.BatchElem{Method: "eth_blockNumber", Result: new(string)}
	}
	if err := r.Client.BatchCallContext(t.Context(), batch); !BatchTooLarge(err) {
		t.Fatalf("got %v, want a batch limit the watcher narrows on", err)
	}
	if failures, _ := health(r, r.pool.endpoints[0]); failures != 0 || r.pool.endpoints[0].refusedCalls != 4 {
		t.Fatalf("%d failures, refused calls %d; want the limit learned, not a rest", failures, r.pool.endpoints[0].refusedCalls)
	}
}

func TestSocketURLsPassTheSameDestinationChecks(t *testing.T) {
	for _, u := range []string{"ws://127.0.0.1:8545", "wss://10.0.0.1/rpc", "wss://user:key@rpc.example.com", "ftp://rpc.example.com"} {
		spec := testSpec(1, u)
		spec.AllowLoopback = false
		if err := validate(spec); err == nil {
			t.Fatalf("%s accepted", u)
		}
	}
	if err := validate(testSpec(1, "wss://rpc.example.com/key")); err != nil {
		t.Fatal(err)
	}
	if got := Redact(fmt.Errorf("dial wss://rpc.example.com/secret-key failed")); strings.Contains(got, "secret-key") {
		t.Fatalf("redacted error still holds the URL: %s", got)
	}
}

func TestCallersOwnDeadlineLeavesTheSharedSocketToOthers(t *testing.T) {
	s := newSocketServer(t, func(string, bool) string {
		time.Sleep(300 * time.Millisecond)
		return `"0x10"`
	})
	r := newRPCs(t, s.ws())
	number(t, t.Context(), r.Client) // connects and measures
	slow := make(chan error, 1)
	go func() {
		_, err := tryNumber(t.Context(), r.Client)
		slow <- err
	}()
	time.Sleep(50 * time.Millisecond)
	short, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	if _, err := tryNumber(short, r.Client); err == nil {
		t.Fatal("a call past its own deadline answered")
	}
	if err := <-slow; err != nil {
		t.Fatalf("another caller's deadline broke this call: %v", err)
	}
	if failures, _ := health(r, r.pool.endpoints[0]); failures != 0 || s.upgrades.Load() != 1 {
		t.Fatalf("%d failures, %d connections; want the connection kept", failures, s.upgrades.Load())
	}
}

func TestSocketAnswerOverItsSizeLimitDropsTheConnection(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			_, body, err := conn.ReadMessage()
			if err != nil {
				return
			}
			calls, batch, _ := messages(body)
			if !batch {
				conn.WriteMessage(websocket.TextMessage, fmt.Appendf(nil, `{"jsonrpc":"2.0","id":%s,"result":"0x7a69"}`, calls[0]["id"]))
				continue
			}
			for _, c := range calls { // each frame fits, together they don't
				conn.WriteMessage(websocket.TextMessage, fmt.Appendf(nil, `[{"jsonrpc":"2.0","id":%s,"result":"0x%s"}]`, c["id"], strings.Repeat("ab", 250)))
			}
		}
	}))
	t.Cleanup(server.Close)
	r := newRPCs(t, "ws"+strings.TrimPrefix(server.URL, "http"))
	r.pool.endpoints[0].sock.limit = 1500
	batch := make([]rpc.BatchElem, 4)
	for i := range batch {
		batch[i] = rpc.BatchElem{Method: "eth_blockNumber", Result: new(string)}
	}
	if err := r.Client.BatchCallContext(t.Context(), batch); err == nil {
		t.Fatal("an answer of 4 frames over the size limit was taken")
	}
}

func TestRequestsWaitingForADialKeepTheirDeadlines(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select { // the upgrade hangs
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(server.Close)
	t.Cleanup(func() { close(release) })
	s := newSocket("ws"+strings.TrimPrefix(server.URL, "http"), &websocket.Dialer{HandshakeTimeout: 3 * time.Second})
	go s.send(t.Context(), []byte(`{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}`))
	time.Sleep(50 * time.Millisecond)
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	began := time.Now()
	if _, _, _, err := s.send(ctx, []byte(`{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}`)); err == nil {
		t.Fatal("answered without a connection")
	}
	if waited := time.Since(began); waited > time.Second {
		t.Fatalf("waited %v behind another request's dial, past its own 200 ms deadline", waited)
	}
}
