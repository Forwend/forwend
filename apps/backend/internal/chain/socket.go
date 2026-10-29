package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// socketIdle: a connection unused this long is replaced before the next request. PublicNode drops silent ones at
	// 60 s, and a request sent as it does would be lost.
	socketIdle = 45 * time.Second
	// socketBatch: PublicNode never answers a WebSocket batch of more calls, and then stops answering on that connection.
	socketBatch = 50
)

// socket is one persistent WebSocket connection to a wss endpoint, shared by its requests. Each call gets an id unique
// on the connection, so answers find their requests whatever ids the callers chose.
type socket struct {
	url    string // secret: never log or return
	dialer *websocket.Dialer
	limit  int // bytes in one answer, over all its frames

	mu      sync.Mutex
	conn    *websocket.Conn
	dialing chan struct{} // closed when the dial in progress ends
	usedAt  time.Time
	lastID  uint64
	waiting map[uint64]*exchange
}

type exchange struct {
	ids    map[uint64]json.RawMessage // connection id → the caller's id
	batch  bool
	got    []map[string]json.RawMessage // answers so far: a provider may split a batch's answers over several frames
	size   int
	answer chan []byte // closed when the connection drops first
}

// errAttemptTimeout is the cause of a pool attempt's timeout; a caller's own deadline leaves the connection to others.
var errAttemptTimeout = errors.New("attempt timeout")

// socketLost: the connection was open and then failed or went silent. Unlike a failed dial, it says nothing about the
// host's HTTPS endpoints.
type socketLost struct{ reason string }

func (s socketLost) Error() string { return s.reason }

func newSocket(url string, dialer *websocket.Dialer) *socket {
	return &socket{url: url, dialer: dialer, limit: maxAnswer, waiting: map[uint64]*exchange{}}
}

// send returns the answer, or the status and header of a refused upgrade; err is a failed dial or a socketLost.
func (s *socket) send(ctx context.Context, body []byte) ([]byte, int, http.Header, error) {
	calls, batch, err := messages(body)
	if err != nil {
		return nil, 0, nil, socketLost{"invalid request"}
	}
	conn, status, header, err := s.connect(ctx)
	if conn == nil {
		return nil, status, header, err
	}
	s.mu.Lock()
	if s.conn != conn {
		s.mu.Unlock()
		return nil, 0, nil, socketLost{"connection lost"}
	}
	x := &exchange{ids: map[uint64]json.RawMessage{}, batch: batch, answer: make(chan []byte, 1)}
	for _, call := range calls {
		s.lastID++
		x.ids[s.lastID], call["id"] = call["id"], json.RawMessage(strconv.FormatUint(s.lastID, 10))
		s.waiting[s.lastID] = x
	}
	out := encode(calls, batch)
	deadline, ok := ctx.Deadline()
	if !ok {
		deadline = time.Now().Add(AttemptTimeout)
	}
	_ = conn.SetWriteDeadline(deadline)
	s.usedAt = time.Now()
	if err := conn.WriteMessage(websocket.TextMessage, out); err != nil {
		s.dropLocked(conn)
		s.mu.Unlock()
		return nil, 0, nil, socketLost{"connection lost"}
	}
	s.mu.Unlock()
	select {
	case raw, ok := <-x.answer:
		if !ok {
			return nil, 0, nil, socketLost{"connection lost"}
		}
		return raw, http.StatusOK, http.Header{}, nil
	case <-ctx.Done():
		s.mu.Lock()
		for id := range x.ids {
			delete(s.waiting, id)
		}
		// No answer within the attempt: the connection may be stalled, so the next request gets a new one.
		if errors.Is(context.Cause(ctx), errAttemptTimeout) {
			s.dropLocked(conn)
		}
		s.mu.Unlock()
		return nil, 0, nil, socketLost{"no answer in time"}
	}
}

// connect returns the live connection, or dials one. One dial runs at a time, outside the lock, so requests that wait
// for it keep their own deadlines.
func (s *socket) connect(ctx context.Context) (*websocket.Conn, int, http.Header, error) {
	for {
		s.mu.Lock()
		if s.conn != nil && time.Since(s.usedAt) < socketIdle {
			conn := s.conn
			s.mu.Unlock()
			return conn, 0, nil, nil
		}
		if wait := s.dialing; wait != nil {
			s.mu.Unlock()
			select {
			case <-wait:
				continue
			case <-ctx.Done():
				return nil, 0, nil, socketLost{"no answer in time"}
			}
		}
		if s.conn != nil {
			s.dropLocked(s.conn)
		}
		s.dialing = make(chan struct{})
		s.mu.Unlock()
		conn, res, err := s.dialer.DialContext(ctx, s.url, nil)
		s.mu.Lock()
		close(s.dialing)
		s.dialing = nil
		if err == nil {
			conn.SetReadLimit(int64(s.limit))
			s.conn, s.usedAt = conn, time.Now()
			go s.read(conn)
		}
		s.mu.Unlock()
		if err != nil && res != nil {
			return nil, res.StatusCode, res.Header, nil
		}
		return conn, 0, nil, err
	}
}

func (s *socket) read(conn *websocket.Conn) {
	for {
		kind, raw, err := conn.ReadMessage()
		if err == nil && kind != websocket.TextMessage {
			err = errors.New("not a text frame")
		}
		if err == nil {
			err = s.deliver(conn, raw)
		}
		if err != nil {
			s.mu.Lock()
			s.dropLocked(conn)
			s.mu.Unlock()
			return
		}
	}
}

// deliver gives each answer to its request with the caller's id back; a request is answered once all its calls are.
// A whole-request error without an id goes to the only request waiting; with several, nobody can tell whose it is,
// so the connection drops and they fail over.
func (s *socket) deliver(conn *websocket.Conn, raw []byte) error {
	answers, batch, err := messages(raw)
	if err != nil {
		return err
	}
	if !batch && answers[0]["method"] != nil {
		return nil // a server notification: this pool subscribes to nothing
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn != conn {
		return nil
	}
	counted := map[*exchange]bool{}
	tooBig := func(x *exchange) bool {
		if !counted[x] {
			counted[x], x.size = true, x.size+len(raw)
		}
		return x.size > s.limit
	}
	for _, a := range answers {
		id, err := strconv.ParseUint(string(a["id"]), 10, 64)
		if err == nil {
			x := s.waiting[id]
			if x == nil {
				continue // the answer to a request that stopped waiting
			}
			if tooBig(x) {
				return errors.New("answer over the size limit")
			}
			a["id"] = x.ids[id]
			x.got = append(x.got, a)
			delete(s.waiting, id)
			if len(x.got) == len(x.ids) {
				x.answer <- encode(x.got, x.batch)
			}
			continue
		}
		var x *exchange
		for _, w := range s.waiting {
			if x != nil && w != x {
				return errors.New("unattributable answer")
			}
			x = w
		}
		if x == nil {
			continue
		}
		for id, original := range x.ids {
			if len(x.ids) == 1 {
				a["id"] = original
			}
			delete(s.waiting, id)
		}
		x.answer <- encode([]map[string]json.RawMessage{a}, false)
	}
	return nil
}

// dropLocked closes conn if it is still the current connection, and fails every request waiting on it.
func (s *socket) dropLocked(conn *websocket.Conn) {
	if s.conn != conn {
		return
	}
	conn.Close()
	s.conn = nil
	for _, x := range s.waiting {
		for id := range x.ids {
			delete(s.waiting, id) // so a batch's other ids don't come up again in this loop
		}
		close(x.answer)
	}
}

// messages reads one JSON-RPC message or a batch of them, keeping every field as sent.
func messages(raw []byte) ([]map[string]json.RawMessage, bool, error) {
	batch := bytes.HasPrefix(bytes.TrimSpace(raw), []byte("["))
	var list []map[string]json.RawMessage
	var err error
	if batch {
		err = json.Unmarshal(raw, &list)
	} else {
		list = make([]map[string]json.RawMessage, 1)
		err = json.Unmarshal(raw, &list[0])
	}
	if err == nil && (len(list) == 0 || slices.ContainsFunc(list, func(m map[string]json.RawMessage) bool { return m == nil })) {
		err = errors.New("empty JSON-RPC message")
	}
	return list, batch, err
}

func encode(messages []map[string]json.RawMessage, batch bool) []byte {
	var out []byte
	if batch {
		out, _ = json.Marshal(messages)
	} else {
		out, _ = json.Marshal(messages[0])
	}
	return out
}

func (s *socket) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn != nil {
		s.dropLocked(s.conn)
	}
}
