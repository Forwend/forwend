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
	tier        Tier
	budgetGroup string
	checkedAt   time.Time
	probing     bool

	checked   bool
	wrong     bool // serves another chain: never used
	failures  int  // in a row
	restUntil time.Time
	next      time.Time // pacing: the earliest start of its next request

	// Measured service: answer time and failure share, both moving averages.
	latency  time.Duration
	failRate float64
	usedAt   time.Time
	// The smallest log range and batch it refused, forgotten after RefusalMemory.
	refusedBlocks uint64
	refusedCalls  int
	refusedAt     time.Time
}

// MeasureMemory: an endpoint unused this long is measured afresh, so one slow answer doesn't bench it for good.
const MeasureMemory = 10 * time.Minute

// RefusalMemory: an endpoint whose plan changed is tried with larger requests again after this.
const RefusalMemory = time.Hour

// cost is how long an answer is expected to take once the endpoint is free; unmeasured endpoints cost nothing, so
// each gets measured.
func (e *endpoint) cost(now time.Time) time.Duration {
	if now.Sub(e.usedAt) > MeasureMemory {
		return 0
	}
	return time.Duration(float64(e.latency) * (1 + 4*e.failRate))
}

func (e *endpoint) refuses(r request, now time.Time) bool {
	if now.Sub(e.refusedAt) > RefusalMemory {
		return false
	}
	return r.blocks > 0 && e.refusedBlocks > 0 && r.blocks >= e.refusedBlocks ||
		r.calls > 1 && e.refusedCalls > 0 && r.calls >= e.refusedCalls
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
	endpoints []*endpoint // private before public, then priority and ID: the order before any measurement
}

// transport sends each call or batch through the endpoint pool.
type transport struct {
	p *pool
}

func (r transport) RoundTrip(req *http.Request) (*http.Response, error) {
	body, err := io.ReadAll(req.Body)
	req.Body.Close()
	if err != nil {
		return nil, err
	}
	return r.p.do(req.Context(), req.Header, body)
}

var ErrUnavailable = errors.New("RPC endpoints unavailable")

const RequestTimeout = 30 * time.Second
const HealthInterval = 30 * time.Second

// A request one endpoint refuses as too large goes to the others first: plans differ, and the caller should narrow
// only when no endpoint takes it. The refusal is returned only then.
func (p *pool) do(ctx context.Context, header http.Header, body []byte) (*http.Response, error) {
	r, err := parseRequest(body)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, RequestTimeout)
	defer cancel()
	tried := map[*endpoint]bool{}
	var refused *http.Response
	for len(tried) < len(p.endpoints) {
		e, at, probe, err := p.pick(ctx, r, tried)
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
			if refused != nil && errors.Is(err, ErrUnavailable) {
				return refused, nil
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
		var size refusal
		if errors.As(err, &size) {
			p.refused(e, r, size.batch)
			p.done(e, nil, probe)
			if refused != nil {
				refused.Body.Close()
			}
			refused = size.res
			continue
		}
		p.done(e, err, probe)
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if err == nil {
			if refused != nil {
				refused.Body.Close()
			}
			return res, nil
		}
	}
	if refused != nil {
		return refused, nil
	}
	return nil, fmt.Errorf("chain %d: %w", p.chainID, ErrUnavailable)
}

// refusal is an answer refusing the request's size (a log range, its result or a batch), not a failing endpoint.
type refusal struct {
	res   *http.Response
	batch bool
}

func (refusal) Error() string { return "request size refused" }

func (p *pool) refused(e *endpoint, r request, batch bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	if now.Sub(e.refusedAt) > RefusalMemory {
		e.refusedBlocks, e.refusedCalls = 0, 0
	}
	// A refused single block is its result size, as with log spam: no endpoint does better, so nothing is learned.
	switch {
	case batch && (e.refusedCalls == 0 || r.calls < e.refusedCalls):
		e.refusedCalls = r.calls
	case !batch && r.blocks > 1 && (e.refusedBlocks == 0 || r.blocks < e.refusedBlocks):
		e.refusedBlocks = r.blocks
	default:
		return
	}
	e.refusedAt = now
	slog.Info("RPC refuses a request size", "chain", p.chainID, "rpc", e.name, "blocks", e.refusedBlocks, "calls", e.refusedCalls)
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

// pick prefers, in order: an endpoint not known to refuse the request's size, a private one, then the soonest
// expected answer (its pacing wait plus its measured answer time). The configured order breaks ties.
func (p *pool) pick(ctx context.Context, r request, tried map[*endpoint]bool) (*endpoint, time.Time, bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	pending, late := false, false
	var best *endpoint
	var bestAt time.Time
	var bestRefuses, bestPublic bool
	var bestCost time.Duration
	for _, e := range p.endpoints {
		if !tried[e] && !e.wrong && e.probing {
			pending = true
		}
		if tried[e] || e.wrong || e.probing || e.restUntil.After(now) {
			continue
		}
		at := now
		if e.next.After(at) {
			at = e.next
		}
		if deadline, ok := ctx.Deadline(); ok && at.After(deadline) {
			late = true
			continue
		}
		refuses, public, cost := e.refuses(r, now), e.tier == Public, at.Sub(now)+e.cost(now)
		better := best == nil
		switch {
		case better:
		case refuses != bestRefuses:
			better = !refuses
		case public != bestPublic:
			better = !public
		default:
			better = cost < bestCost
		}
		if better {
			best, bestAt, bestRefuses, bestPublic, bestCost = e, at, refuses, public, cost
		}
	}
	if best != nil {
		best.next = bestAt.Add(time.Duration(r.calls) * p.perCall)
		if !best.checked || best.failures > 0 || now.Sub(best.checkedAt) >= HealthInterval {
			best.probing = true
		}
		return best, bestAt, best.probing, nil
	}
	if late {
		return nil, time.Time{}, false, context.DeadlineExceeded
	}
	if pending {
		if p.changed == nil {
			p.changed = make(chan struct{})
		}
		return nil, time.Time{}, false, probePending{p.changed}
	}
	return nil, time.Time{}, false, fmt.Errorf("chain %d: %w", p.chainID, ErrUnavailable)
}

func (p *pool) done(e *endpoint, failure error, probe bool) {
	p.mu.Lock()
	if probe {
		e.probing = false
		p.changedLocked()
	}
	if failure == nil {
		e.failRate *= 0.8
		if !e.restUntil.After(time.Now()) {
			e.failures = 0
		}
		p.mu.Unlock()
		return
	}
	e.failRate = 0.8*e.failRate + 0.2
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

func (p *pool) serves() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, e := range p.endpoints {
		if !e.wrong {
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
	began := time.Now()
	res, err := p.http.Do(req)
	if err != nil {
		return nil, p.unanswered(e, err)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxAnswer+1))
	res.Body.Close()
	if err != nil {
		return nil, p.unanswered(e, err)
	}
	took := time.Since(began)
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
		p.measured(e, took)
		return nil, refusal{res: res, batch: batchLimit}
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
	// Only answers count toward the answer time: a fast error must not make an endpoint look fast.
	p.measured(e, took)
	if r, _ := parseRequest(body); r.blocks > 0 && bytes.Contains(safe, []byte(`"log result size too large"`)) {
		return nil, refusal{res: res}
	}
	return res, nil
}

// measured keeps a moving average of the endpoint's answer time; one that sat unused starts again.
func (p *pool) measured(e *endpoint, took time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	if now.Sub(e.usedAt) > MeasureMemory {
		e.latency = took
	} else {
		e.latency = (4*e.latency + took) / 5
	}
	e.usedAt = now
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
