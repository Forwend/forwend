package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/rpc"
)

const (
	// AttemptTimeout bounds one request to one endpoint: a slower endpoint rests and the request moves on.
	AttemptTimeout = 5 * time.Second
	// RestBase is the rest of an endpoint after one failure; each failure in a row doubles it, up to RestMax.
	RestBase = time.Second
	RestMax  = 5 * time.Minute
)

type endpoint struct {
	url  string // may hold an Infura key: never log it or put it in an error
	host string
	name string // host and list position, safe to log

	checked   bool
	wrong     bool // serves another chain: never used
	failures  int  // in a row
	restUntil time.Time
	next      time.Time // pacing: the earliest start of its next request
}

type pool struct {
	chainID uint64
	perCall time.Duration // 1 / the rate: the pause one call takes from an endpoint's pace
	timeout time.Duration // per attempt
	http    *http.Client

	mu        sync.Mutex
	endpoints []*endpoint // every Infura key, then the public RPCs, in list order
}

// role replaces the HTTP transport of a role's go-ethereum client, so each request (a call or a batch) goes to the pool.
type role struct {
	p      *pool
	second bool
}

func (r role) RoundTrip(req *http.Request) (*http.Response, error) {
	body, err := io.ReadAll(req.Body)
	req.Body.Close()
	if err != nil {
		return nil, err
	}
	return r.p.do(req.Context(), r.second, req.Header, body)
}

// do sends one request for a role. When an endpoint fails (no answer in time, a connection error, an HTTP error status
// or a rate-limit answer), it rests and the request goes to the next endpoint at once, at most once per endpoint and
// once more. Any other answer, a JSON-RPC error such as a revert included, is the call's and is returned as it is.
func (p *pool) do(ctx context.Context, second bool, header http.Header, body []byte) (*http.Response, error) {
	calls := 1
	if b := bytes.TrimSpace(body); len(b) > 0 && b[0] == '[' {
		var batch []json.RawMessage
		if json.Unmarshal(b, &batch) == nil {
			calls = len(batch)
		}
	}
	var res *http.Response
	var err error
	for tries := 0; tries <= len(p.endpoints); {
		e, at, ready, perr := p.pick(second, calls)
		if perr != nil {
			return nil, perr
		}
		if deadline, ok := ctx.Deadline(); ok && at.After(deadline) {
			break
		}
		if werr := sleepUntil(ctx, at); werr != nil {
			return nil, werr
		}
		if !ready || p.resting(e) {
			continue // it was resting, or began to while this request waited its turn: pick again, the roles may have moved
		}
		tries++
		res, err = p.send(ctx, e, header, body)
		if err == nil {
			p.done(e, nil)
			return res, nil
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			return nil, ctx.Err() // the caller gave up: that says nothing about the endpoint
		}
		p.done(e, err)
		if ctx.Err() != nil {
			break
		}
	}
	if res != nil {
		return res, nil // the last endpoint's own answer: an HTTP error status or a rate limit
	}
	if err == nil {
		err = fmt.Errorf("chain %d: no %s RPC can answer in time; the others rest", p.chainID, roleName(second))
	}
	return nil, err
}

// pick returns the endpoint for a role's next request and when it may start. The primary uses the first host in list
// order with an endpoint that is not resting, the second the first other such host, so the two roles are always on
// different hosts (D-15). Within the host the endpoint free soonest is taken and the request's calls are added to its
// pace. When every endpoint the role may use rests, ready is false and at is when the first one is back.
func (p *pool) pick(second bool, calls int) (e *endpoint, at time.Time, ready bool, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	e = p.best(now, "")
	if e != nil && second {
		e = p.best(now, e.host)
	}
	if e == nil {
		return nil, time.Time{}, false, fmt.Errorf("chain %d: no %s RPC host serves this chain; D-15 needs two",
			p.chainID, roleName(second))
	}
	if e.restUntil.After(now) {
		return e, e.restUntil, false, nil
	}
	at = now
	if e.next.After(now) {
		at = e.next
	}
	e.next = at.Add(time.Duration(calls) * p.perCall)
	return e, at, true, nil
}

func (p *pool) best(now time.Time, skip string) *endpoint {
	var host string
	var free, back *endpoint
	for _, e := range p.endpoints {
		switch {
		case e.wrong || e.host == skip:
		case e.restUntil.After(now):
			if back == nil || e.restUntil.Before(back.restUntil) {
				back = e
			}
		case host == "" || e.host == host:
			host = e.host
			if free == nil || e.next.Before(free.next) {
				free = e
			}
		}
	}
	if free != nil {
		return free
	}
	return back
}

func (p *pool) done(e *endpoint, failure error) {
	p.mu.Lock()
	if failure == nil {
		e.failures = 0
		p.mu.Unlock()
		return
	}
	if e.restUntil.After(time.Now()) {
		p.mu.Unlock()
		return // a request sent before this rest began: the rest already counts its failure
	}
	e.failures++
	rest := restFor(e.failures, rand.Float64())
	e.restUntil = time.Now().Add(rest)
	p.mu.Unlock()
	slog.Warn("RPC rests", "chain", p.chainID, "rpc", e.name, "for", rest.Round(time.Millisecond), "err", failure)
}

// answered counts the hosts with an endpoint that matched the chain ID and answered its last request, and all hosts.
func (p *pool) answered() (ok, all int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	good, hosts := map[string]bool{}, map[string]bool{}
	for _, e := range p.endpoints {
		hosts[e.host] = true
		if e.checked && !e.wrong && e.failures == 0 {
			good[e.host] = true
		}
	}
	return len(good), len(hosts)
}

func (p *pool) resting(e *endpoint) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return e.restUntil.After(time.Now())
}

// restFor is the rest after failures in a row. Its second half is random (0 ≤ jitter < 1), so endpoints that failed
// together don't all come back at once.
func restFor(failures int, jitter float64) time.Duration {
	d := RestMax
	if failures <= 16 {
		d = min(RestMax, RestBase<<(failures-1))
	}
	return d/2 + time.Duration(jitter*float64(d/2))
}

func (p *pool) send(ctx context.Context, e *endpoint, header http.Header, body []byte) (*http.Response, error) {
	p.mu.Lock()
	checked := e.checked
	p.mu.Unlock()
	if !checked {
		if err := p.check(ctx, e, header); err != nil {
			return nil, err
		}
	}
	return p.post(ctx, e, header, body)
}

// check runs once per endpoint before its first call: a URL is used only after its chain ID matches (D-15).
func (p *pool) check(ctx context.Context, e *endpoint, header http.Header) error {
	res, err := p.post(ctx, e, header, []byte(`{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}`))
	if err != nil {
		return err
	}
	var answer struct{ Result *hexutil.Uint64 }
	if json.NewDecoder(res.Body).Decode(&answer) != nil || answer.Result == nil {
		return fmt.Errorf("%s: no chain ID", e.name)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if uint64(*answer.Result) != p.chainID {
		e.wrong = true
		slog.Error("RPC serves another chain; not used", "chain", p.chainID, "rpc", e.name, "serves", uint64(*answer.Result))
		return fmt.Errorf("%s: serves chain %d", e.name, uint64(*answer.Result))
	}
	e.checked = true
	return nil
}

// maxAnswer bounds one RPC answer, far above a 2,000-block eth_getLogs, so a hostile host can't exhaust memory.
const maxAnswer = 64 << 20

func (p *pool) post(ctx context.Context, e *endpoint, header http.Header, body []byte) (*http.Response, error) {
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%s: invalid URL", e.name)
	}
	req.Header = header.Clone()
	res, err := p.http.Do(req)
	if err != nil {
		return nil, p.unanswered(e, err)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxAnswer+1))
	res.Body.Close()
	if err != nil {
		return nil, p.unanswered(e, err)
	}
	if len(raw) > maxAnswer {
		return nil, fmt.Errorf("%s: answer over %d bytes", e.name, maxAnswer)
	}
	res.Body = io.NopCloser(bytes.NewReader(raw))
	if res.StatusCode/100 != 2 {
		return res, fmt.Errorf("%s: HTTP %s", e.name, res.Status)
	}
	if reason := outage(raw); reason != "" {
		return res, fmt.Errorf("%s: %s", e.name, reason)
	}
	return res, nil
}

// unanswered describes a request without an answer, leaving out the URL: net/http puts it, Infura key included, in
// its errors.
func (p *pool) unanswered(e *endpoint, err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("%s: no answer in time: %w", e.name, context.DeadlineExceeded)
	}
	var u *url.Error
	if errors.As(err, &u) {
		err = u.Err
	}
	return fmt.Errorf("%s: %w", e.name, err)
}

// outage says why a 200 answer is about the endpoint rather than the call, or returns "". A rate limit on any call
// of a batch sends the whole batch to the next endpoint.
func outage(raw []byte) string {
	type answer struct {
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	var answers []answer
	raw = bytes.TrimSpace(raw)
	if len(raw) > 0 && raw[0] == '[' {
		if json.Unmarshal(raw, &answers) != nil {
			return "answer is not JSON-RPC"
		}
	} else {
		var one answer
		if json.Unmarshal(raw, &one) != nil {
			return "answer is not JSON-RPC"
		}
		answers = []answer{one}
	}
	for _, a := range answers {
		if a.Error != nil && rateLimited(a.Error.Code, a.Error.Message) {
			return fmt.Sprintf("rate limited (%d %s)", a.Error.Code, a.Error.Message)
		}
	}
	return ""
}

// rateLimited reports a JSON-RPC error that means "slow down", not an answer to the call: code 429, -32005 (EIP-1474
// "limit exceeded", Infura's rate limits), -32007 (QuickNode's request limit), or a message that says so. Infura also
// answers -32005 when a log query has too many results: that is about the call, and the watcher narrows its range.
func rateLimited(code int, message string) bool {
	m := strings.ToLower(message)
	if tooLarge(m) {
		return false
	}
	return code == 429 || code == -32005 || code == -32007 ||
		strings.Contains(m, "rate limit") || strings.Contains(m, "rate exceeded") || strings.Contains(m, "too many requests")
}

// tooLarge reports a lowercase error message about a log query's block range or result size, such as "query returned
// more than 10000 results" (Infura), "exceed maximum block range" or "log response size exceeded".
func tooLarge(m string) bool {
	return strings.Contains(m, "range") || strings.Contains(m, "result") || strings.Contains(m, "size") ||
		strings.Contains(m, "too large")
}

// Overloaded reports an error that a smaller eth_getLogs block range may avoid: a rate limit that every endpoint
// answered (HTTP 429 or a JSON-RPC rate-limit error), or an RPC refusing the range or the size of the result.
func Overloaded(err error) bool {
	var status rpc.HTTPError
	if errors.As(err, &status) {
		return status.StatusCode == http.StatusTooManyRequests
	}
	var e rpc.Error
	if !errors.As(err, &e) {
		return false
	}
	return rateLimited(e.ErrorCode(), e.Error()) || tooLarge(strings.ToLower(e.Error()))
}

func roleName(second bool) string {
	if second {
		return "second"
	}
	return "primary"
}

func sleepUntil(ctx context.Context, at time.Time) error {
	d := time.Until(at)
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
