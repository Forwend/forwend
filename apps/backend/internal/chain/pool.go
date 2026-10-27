package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/rpc"
)

const (
	// AttemptTimeout bounds one request to one endpoint: a slower endpoint rests and the request moves on.
	AttemptTimeout = 5 * time.Second
	RestBase       = time.Second
	RestMax        = 5 * time.Minute
)

type endpoint struct {
	url         string // secret: never log or return
	host        string
	name        string // configured non-secret endpoint ID
	second      bool
	budgetGroup string
	checkedAt   time.Time
	probing     bool

	checked   bool
	wrong     bool // serves another chain: never used
	failures  int  // in a row
	restUntil time.Time
	next      time.Time // pacing: the earliest start of its next request
}

type pool struct {
	chainID    uint64
	perCall    time.Duration
	timeout    time.Duration // per attempt
	maxHeadAge time.Duration
	http       *http.Client
	budget     *Budget

	mu        sync.Mutex
	changed   chan struct{}
	endpoints []*endpoint // private before public, then priority and ID
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

var ErrUnavailable = errors.New("RPC endpoints unavailable")

const RequestTimeout = 30 * time.Second
const HealthInterval = 30 * time.Second

func (p *pool) do(ctx context.Context, second bool, header http.Header, body []byte) (*http.Response, error) {
	calls, err := requestCalls(body)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, RequestTimeout)
	defer cancel()
	tried := map[*endpoint]bool{}
	for len(tried) < len(p.endpoints) {
		e, at, probe, err := p.pick(ctx, second, calls, tried)
		if err != nil {
			var pending probePending
			if errors.As(err, &pending) {
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-pending.done:
					continue
				}
			}
			return nil, err
		}
		tried[e] = true
		if err = sleepUntil(ctx, at); err != nil {
			p.release(e, probe)
			return nil, err
		}
		if p.resting(e) {
			p.release(e, probe)
			continue
		}
		res, err := p.send(ctx, e, header, body, probe)
		var budgetErr budgetError
		if errors.As(err, &budgetErr) {
			p.release(e, probe)
			return nil, err
		}
		if ctx.Err() != nil {
			p.release(e, probe)
			return nil, ctx.Err()
		}
		p.done(e, err, probe)
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if err == nil {
			return res, nil
		}
	}
	return nil, fmt.Errorf("chain %d %s: %w", p.chainID, roleName(second), ErrUnavailable)
}

type probePending struct{ done <-chan struct{} }

func (probePending) Error() string { return "RPC health probe pending" }

func (p *pool) changedLocked() {
	if p.changed != nil {
		close(p.changed)
	}
	p.changed = make(chan struct{})
}

func (p *pool) release(e *endpoint, probe bool) {
	if !probe {
		return
	}
	p.mu.Lock()
	e.probing = false
	p.changedLocked()
	p.mu.Unlock()
}

func (p *pool) pick(ctx context.Context, second bool, calls int, tried map[*endpoint]bool) (*endpoint, time.Time, bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	pending := false
	for _, e := range p.endpoints {
		if !tried[e] && !e.wrong && e.second == second && e.probing {
			pending = true
		}
		if tried[e] || e.wrong || e.second != second || e.probing || e.restUntil.After(now) {
			continue
		}
		at := now
		if e.next.After(at) {
			at = e.next
		}
		if deadline, ok := ctx.Deadline(); ok && at.After(deadline) {
			return nil, time.Time{}, false, context.DeadlineExceeded
		}
		e.next = at.Add(time.Duration(calls) * p.perCall)
		if !e.checked || e.failures > 0 || now.Sub(e.checkedAt) >= HealthInterval {
			e.probing = true
		}
		return e, at, e.probing, nil
	}
	if pending {
		if p.changed == nil {
			p.changed = make(chan struct{})
		}
		return nil, time.Time{}, false, probePending{p.changed}
	}
	return nil, time.Time{}, false, fmt.Errorf("chain %d %s: %w", p.chainID, roleName(second), ErrUnavailable)
}

func (p *pool) done(e *endpoint, failure error, probe bool) {
	p.mu.Lock()
	if probe {
		e.probing = false
		p.changedLocked()
	}
	if failure == nil {
		if !e.restUntil.After(time.Now()) {
			e.failures = 0
		}
		p.mu.Unlock()
		return
	}
	if e.restUntil.After(time.Now()) {
		p.mu.Unlock()
		return // a request sent before this rest began: the rest already counts its failure
	}
	e.failures++
	n := e.failures
	if errors.As(failure, new(lasting)) {
		n = math.MaxInt
	}
	rest := restFor(n, rand.Float64())
	var retry retryAfter
	if errors.As(failure, &retry) {
		rest = max(rest, retry.delay)
	}
	e.restUntil = time.Now().Add(rest)
	e.checked = false
	if errors.As(failure, new(hostDown)) {
		for _, other := range p.endpoints {
			if other.host == e.host && other.restUntil.Before(e.restUntil) {
				other.failures, other.restUntil = max(other.failures, e.failures), e.restUntil
				other.checked = false
			}
		}
	}
	p.mu.Unlock()
	slog.Warn("RPC rests", "chain", p.chainID, "rpc", e.name, "for", rest.Round(time.Millisecond), "err", failure)
}

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

func (p *pool) serves(second bool) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, e := range p.endpoints {
		if e.second == second && !e.wrong {
			return true
		}
	}
	return false
}

func (p *pool) resting(e *endpoint) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return e.restUntil.After(time.Now())
}

// restFor's second half is random (0 ≤ jitter < 1) so endpoints that failed together don't come back at once.
func restFor(failures int, jitter float64) time.Duration {
	d := RestMax
	if failures <= 16 {
		d = min(RestMax, RestBase<<(failures-1))
	}
	return d/2 + time.Duration(jitter*float64(d/2))
}

func (p *pool) send(ctx context.Context, e *endpoint, header http.Header, body []byte, probe bool) (*http.Response, error) {
	if probe {
		if err := p.check(ctx, e, header); err != nil {
			return nil, err
		}
	}

	return p.post(ctx, e, header, body)
}

func (p *pool) check(ctx context.Context, e *endpoint, header http.Header) error {
	res, err := p.post(ctx, e, header, []byte(`{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}`))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var answer struct{ Result *hexutil.Uint64 }
	if json.NewDecoder(res.Body).Decode(&answer) != nil || answer.Result == nil {
		return fmt.Errorf("%s: no chain ID", e.name)
	}
	if uint64(*answer.Result) != p.chainID {
		p.mu.Lock()
		e.wrong = true
		p.mu.Unlock()
		return lasting{fmt.Errorf("%s: wrong chain", e.name)}
	}
	if p.maxHeadAge > 0 {
		for _, tag := range []string{"latest", "finalized"} {
			body := fmt.Appendf(nil, `{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":[%q,false]}`, tag)
			res, err := p.post(ctx, e, header, body)
			if err != nil {
				return err
			}
			var head struct {
				Result *struct {
					Number    *hexutil.Uint64
					Timestamp *hexutil.Uint64
					Hash      string
				}
			}
			err = json.NewDecoder(res.Body).Decode(&head)
			res.Body.Close()
			if err != nil || head.Result == nil || head.Result.Number == nil || head.Result.Timestamp == nil || len(head.Result.Hash) != 66 {
				return fmt.Errorf("%s: required %s header unavailable", e.name, tag)
			}
			if tag == "latest" && time.Since(time.Unix(int64(*head.Result.Timestamp), 0)) > p.maxHeadAge {
				return fmt.Errorf("%s: stale latest head", e.name)
			}
		}
	}
	p.mu.Lock()
	e.checked, e.checkedAt = true, time.Now()
	p.mu.Unlock()
	return nil
}

// maxAnswer bounds one RPC answer, far above a 2,000-block eth_getLogs, so a hostile host can't exhaust memory.
const maxAnswer = 64 << 20

func (p *pool) post(ctx context.Context, e *endpoint, header http.Header, body []byte) (*http.Response, error) {
	if p.budget != nil {
		if err := p.budget.wait(ctx, e.budgetGroup, body); err != nil {
			return nil, err
		}
	}
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
	// Classify the provider text before discarding it. No untrusted error body crosses this boundary.
	batchLimit := BatchTooLarge(rpc.HTTPError{StatusCode: http.StatusBadRequest, Body: raw})
	batchRequest := len(bytes.TrimSpace(body)) > 0 && bytes.TrimSpace(body)[0] == '['
	queryLimit := res.StatusCode/100 == 2 && batchRequest && batchLimit || BatchTooLarge(rpc.HTTPError{StatusCode: res.StatusCode, Body: raw}) ||
		(res.StatusCode == 400 || res.StatusCode == 413) && TooLarge(rpc.HTTPError{StatusCode: res.StatusCode, Body: raw})
	if queryLimit {
		message := "log result size too large"
		if batchLimit {
			message = "batch too large"
		}
		safe := fmt.Appendf(nil, `{"jsonrpc":"2.0","id":null,"error":{"code":-32005,"message":%q}}`, message)
		if res.StatusCode/100 == 2 {
			res.StatusCode = http.StatusBadRequest
		}
		res.Status = fmt.Sprintf("%d %s", res.StatusCode, http.StatusText(res.StatusCode))
		res.Header = make(http.Header)
		res.Body = io.NopCloser(bytes.NewReader(safe))
		res.ContentLength = int64(len(safe))
		return res, nil
	}

	if res.StatusCode/100 != 2 && !queryLimit {
		failure := fmt.Errorf("%s: HTTP %d", e.name, res.StatusCode)
		if res.StatusCode == 429 {
			return nil, retryAfter{failure, retryDelay(res.Header.Get("Retry-After"))}
		}
		if res.StatusCode == 401 || res.StatusCode == 403 || res.StatusCode == 404 {
			return nil, lasting{failure}
		}
		return nil, failure
	}
	if reason := outage(raw); reason != "" {
		failure := fmt.Errorf("%s: %s", e.name, reason)
		if reason == notJSONRPC {
			return nil, lasting{failure}
		}
		return nil, failure
	}
	safe, err := safeResponse(raw, body)
	if err != nil {
		return nil, lasting{fmt.Errorf("%s: invalid RPC response", e.name)}
	}
	res.Header = make(http.Header)
	res.Header.Set("Content-Type", "application/json")
	res.StatusCode, res.Status = 200, "200 OK"
	res.Body = io.NopCloser(bytes.NewReader(safe))
	res.ContentLength = int64(len(safe))
	return res, nil
}

type retryAfter struct {
	error
	delay time.Duration
}

func retryDelay(raw string) time.Duration {
	if seconds, err := strconv.ParseInt(raw, 10, 64); err == nil {
		if seconds < 0 {
			return 0
		}
		if seconds >= int64(RestMax/time.Second) {
			return RestMax
		}
		return time.Duration(seconds) * time.Second
	}
	if at, err := http.ParseTime(raw); err == nil {
		return min(RestMax, max(0, time.Until(at)))
	}
	return 0
}

// lasting is a failure that doesn't heal in seconds: its endpoint rests RestMax at once.
type lasting struct{ error }

const notJSONRPC = "answer is not JSON-RPC"

// Network errors may contain the entire URL or reflected credentials; return only a safe category.
func (p *pool) unanswered(e *endpoint, err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return hostDown{fmt.Errorf("%s: timeout: %w", e.name, context.DeadlineExceeded)}
	}
	return hostDown{fmt.Errorf("%s: connection failed", e.name)}
}

// hostDown is a request its host didn't answer (a timeout, a refused or broken connection): every endpoint of that
// host rests with it.
type hostDown struct{ error }

func (h hostDown) Unwrap() error { return h.error }

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
			return notJSONRPC
		}
	} else {
		var one answer
		if json.Unmarshal(raw, &one) != nil {
			return notJSONRPC
		}
		answers = []answer{one}
	}
	for _, a := range answers {
		if a.Error != nil && a.Error.Code == -32002 {
			return "resource unavailable"
		}
		if a.Error != nil && rateLimited(a.Error.Code, a.Error.Message) {
			return "rate limited"
		}
	}
	return ""
}

// rateLimited: code 429, -32005 (EIP-1474, Infura), -32007 (QuickNode) or a message saying so. Infura's -32005 for
// too many log results is about the call (tooLarge), and the watcher narrows its range.
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
	if TooLarge(err) {
		return true
	}
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

func TooLarge(err error) bool {
	var status rpc.HTTPError
	if errors.As(err, &status) && (status.StatusCode == http.StatusBadRequest || status.StatusCode == http.StatusRequestEntityTooLarge) {
		var answer struct{ Error *struct{ Message string } }
		return json.Unmarshal(status.Body, &answer) == nil && answer.Error != nil && tooLarge(strings.ToLower(answer.Error.Message))
	}
	var e rpc.Error
	return errors.As(err, &e) && tooLarge(strings.ToLower(e.Error()))
}

func BatchTooLarge(err error) bool {
	limited := func(message string) bool {
		m := strings.ToLower(message)
		return strings.Contains(m, "batch") && (strings.Contains(m, "not allowed") || strings.Contains(m, "too large") || strings.Contains(m, "maximum batch"))
	}
	var rpcErr rpc.Error
	if errors.As(err, &rpcErr) {
		return limited(rpcErr.Error())
	}
	var status rpc.HTTPError
	if !errors.As(err, &status) || (status.StatusCode != 400 && status.StatusCode != 413 && status.StatusCode != 500) {
		return false
	}
	type answer struct{ Error *struct{ Message string } }
	var answers []answer
	if json.Unmarshal(status.Body, &answers) != nil {
		var one answer
		if json.Unmarshal(status.Body, &one) != nil {
			return false
		}
		answers = []answer{one}
	}
	for _, a := range answers {
		if a.Error != nil && limited(a.Error.Message) {
			return true
		}
	}
	return false
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
