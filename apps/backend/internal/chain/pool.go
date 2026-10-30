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
	sock        *socket // a wss endpoint; nil for https
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
	// The smallest log range, batch and address list it refused, forgotten after RefusalMemory.
	refusedBlocks    uint64
	refusedCalls     int
	refusedAddresses int
	refusedAt        time.Time
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
	if e.sock != nil && r.calls > socketBatch {
		return true
	}
	if now.Sub(e.refusedAt) > RefusalMemory {
		return false
	}
	return r.blocks > 0 && e.refusedBlocks > 0 && r.blocks >= e.refusedBlocks ||
		r.calls > 1 && e.refusedCalls > 0 && r.calls >= e.refusedCalls ||
		r.addresses > 1 && e.refusedAddresses > 0 && r.addresses >= e.refusedAddresses
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
	res, sent, err := p.try(ctx, r, header, body, map[*endpoint]bool{})
	if err == nil && sent != nil && r.broadcast {
		go p.echo(header.Clone(), body, r, sent)
	}
	return res, err
}

// echo sends a signed transaction to one more endpoint, on another host: a node that takes it and never passes it on
// must not hold a settlement back. The bytes are the same, so a second copy changes nothing on chain.
func (p *pool) echo(header http.Header, body []byte, r request, sent *endpoint) {
	// The request limit, not one attempt's: a hung endpoint then rests on its attempt timeout and the next one gets it.
	ctx, cancel := context.WithTimeout(context.Background(), RequestTimeout)
	defer cancel()
	sameHost := map[*endpoint]bool{}
	for _, e := range p.endpoints {
		if e.host == sent.host {
			sameHost[e] = true
		}
	}
	if res, _, err := p.try(ctx, r, header, body, sameHost); err == nil {
		res.Body.Close()
	}
}

// try sends body to the best endpoint not in tried, then the next, until one answers; it returns that endpoint, or
// nil with the refusal every endpoint gave.
func (p *pool) try(ctx context.Context, r request, header http.Header, body []byte, tried map[*endpoint]bool) (*http.Response, *endpoint, error) {
	var refused *http.Response
	refusedMissing, missed := false, 0
	// A miss is the answer only when every endpoint serving the chain gave it: one that failed or rests may hold the
	// data, and callers move past history only when no endpoint keeps it (R-191).
	answer := func() (*http.Response, *endpoint, error) {
		if refusedMissing && missed < p.serving() {
			refused.Body.Close()
			return nil, nil, fmt.Errorf("chain %d: %w", p.chainID, ErrUnavailable)
		}
		return refused, nil, nil
	}
	for len(tried) < len(p.endpoints) {
		e, at, probe, err := p.pick(ctx, r, tried)
		if err != nil {
			var pending probePending
			if errors.As(err, &pending) {
				select {
				case <-ctx.Done():
					return nil, nil, ctx.Err()
				case <-pending.done:
					continue
				}
			}
			if refused != nil && errors.Is(err, ErrUnavailable) {
				return answer()
			}
			return nil, nil, err
		}
		tried[e] = true
		if err = sleepUntil(ctx, at); err != nil {
			p.release(e, probe)
			return nil, nil, err
		}
		if p.resting(e) {
			p.release(e, probe)
			continue
		}
		res, err := p.send(ctx, e, header, body, probe)
		var budgetErr budgetError
		if errors.As(err, &budgetErr) {
			p.release(e, probe)
			return nil, nil, err
		}
		if ctx.Err() != nil {
			p.release(e, probe)
			return nil, nil, ctx.Err()
		}
		var size refusal
		if errors.As(err, &size) {
			if size.missing {
				missed++
			} else {
				p.refused(e, r, size)
			}
			p.done(e, nil, probe)
			if refused != nil {
				refused.Body.Close()
			}
			refused, refusedMissing = size.res, size.missing
			continue
		}
		p.done(e, err, probe)
		if ctx.Err() != nil {
			return nil, nil, ctx.Err()
		}
		if err == nil {
			if refused != nil {
				refused.Body.Close()
			}
			return res, e, nil
		}
	}
	if refused != nil {
		return answer()
	}
	return nil, nil, fmt.Errorf("chain %d: %w", p.chainID, ErrUnavailable)
}

// refusal is an answer refusing the request's size (a log range, its result, its address list or a batch), or saying
// the endpoint lacks the block or state asked for: not a failing endpoint, and another may answer.
type refusal struct {
	res       *http.Response
	batch     bool
	addresses bool
	missing   bool
}

func (refusal) Error() string { return "request size refused" }

func (p *pool) refused(e *endpoint, r request, size refusal) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	if now.Sub(e.refusedAt) > RefusalMemory {
		e.refusedBlocks, e.refusedCalls, e.refusedAddresses = 0, 0, 0
	}
	// A refused single block is its result size, as with log spam: no endpoint does better, so nothing is learned.
	switch {
	case size.batch && (e.refusedCalls == 0 || r.calls < e.refusedCalls):
		e.refusedCalls = r.calls
	case size.addresses && (e.refusedAddresses == 0 || r.addresses < e.refusedAddresses):
		e.refusedAddresses = r.addresses
	case !size.batch && !size.addresses && r.blocks > 1 && (e.refusedBlocks == 0 || r.blocks < e.refusedBlocks):
		e.refusedBlocks = r.blocks
	default:
		return
	}
	e.refusedAt = now
	slog.Info("RPC refuses a request size", "chain", p.chainID, "rpc", e.name, "blocks", e.refusedBlocks, "calls", e.refusedCalls,
		"addresses", e.refusedAddresses)
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

// serving counts the endpoints that serve this chain.
func (p *pool) serving() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, e := range p.endpoints {
		if !e.wrong {
			n++
		}
	}
	return n
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
	res, err := p.probe(ctx, e, header, []byte(`{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}`))
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
			res, err := p.probe(ctx, e, header, body)
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

// probe sends one health check. A refusal or a missing block is a failed check: the endpoint can't serve the chain's head.
func (p *pool) probe(ctx context.Context, e *endpoint, header http.Header, body []byte) (*http.Response, error) {
	res, err := p.post(ctx, e, header, body)
	var size refusal
	if errors.As(err, &size) {
		size.res.Body.Close()
		return nil, fmt.Errorf("%s: health check refused", e.name)
	}
	return res, err
}

// maxAnswer bounds one RPC answer, far above a 2,000-block eth_getLogs, so a hostile host can't exhaust memory.
const maxAnswer = 64 << 20

func (p *pool) post(ctx context.Context, e *endpoint, header http.Header, body []byte) (*http.Response, error) {
	if p.budget != nil {
		if err := p.budget.wait(ctx, e.budgetGroup, body); err != nil {
			return nil, err
		}
	}
	ctx, cancel := context.WithTimeoutCause(ctx, p.timeout, errAttemptTimeout)
	defer cancel()
	began := time.Now()
	raw, status, answerHeader, err := p.exchange(ctx, e, header, body)
	if err != nil {
		return nil, err
	}
	took := time.Since(began)
	if len(raw) > maxAnswer {
		return nil, fmt.Errorf("%s: answer over %d bytes", e.name, maxAnswer)
	}
	// Classify the provider text before discarding it. No untrusted error body crosses this boundary.
	batchLimit := BatchTooLarge(rpc.HTTPError{StatusCode: http.StatusBadRequest, Body: raw})
	batchRequest := len(bytes.TrimSpace(body)) > 0 && bytes.TrimSpace(body)[0] == '['
	// A batch can be refused whole by one error answer with no id; over WebSocket it comes with status 200.
	queryLimit := status/100 == 2 && batchRequest && (batchLimit || TooLarge(rpc.HTTPError{StatusCode: http.StatusBadRequest, Body: raw})) ||
		BatchTooLarge(rpc.HTTPError{StatusCode: status, Body: raw}) ||
		(status == 400 || status == 413) && TooLarge(rpc.HTTPError{StatusCode: status, Body: raw})
	// PublicNode refuses more than 10 addresses with HTTP 403 over HTTPS: a refusal of this query, not of the endpoint.
	if r, _ := parseRequest(body); r.addresses > 1 && AddressesTooMany(rpc.HTTPError{StatusCode: http.StatusBadRequest, Body: raw}) {
		p.measured(e, took)
		return nil, refusal{res: answer(http.StatusBadRequest,
			fmt.Appendf(nil, `{"jsonrpc":"2.0","id":null,"error":{"code":-32005,"message":%q}}`, tooManyAddresses)), addresses: true}
	}
	if queryLimit {
		// A batch refused for its size, however the provider words it, is a batch limit, not a log range.
		batchLimit = batchLimit || batchRequest
		message := "log result size too large"
		if batchLimit {
			message = "batch too large"
		}
		if status/100 == 2 {
			status = http.StatusBadRequest
		}
		p.measured(e, took)
		return nil, refusal{res: answer(status, fmt.Appendf(nil, `{"jsonrpc":"2.0","id":null,"error":{"code":-32005,"message":%q}}`, message)),
			batch: batchLimit}
	}

	if status/100 != 2 {
		failure := fmt.Errorf("%s: HTTP %d", e.name, status)
		if status == 429 {
			return nil, retryAfter{failure, retryDelay(answerHeader.Get("Retry-After"))}
		}
		if status == 401 || status == 403 || status == 404 {
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
	res := answer(http.StatusOK, safe)
	if bytes.Contains(safe, []byte(`"message":"`+missing+`"`)) {
		return nil, refusal{res: res, missing: true} // not counted as an answer: a fast miss must not make it look fast
	}
	// Only answers count toward the answer time: a fast error must not make an endpoint look fast.
	p.measured(e, took)
	if r, _ := parseRequest(body); r.blocks > 0 && bytes.Contains(safe, []byte(`"log result size too large"`)) {
		return nil, refusal{res: res}
	}
	return res, nil
}

// exchange sends body to one endpoint over its transport and returns the raw answer with its status.
func (p *pool) exchange(ctx context.Context, e *endpoint, header http.Header, body []byte) ([]byte, int, http.Header, error) {
	if e.sock != nil {
		raw, status, answerHeader, err := e.sock.send(ctx, body)
		var lost socketLost
		if errors.As(err, &lost) {
			return nil, 0, nil, fmt.Errorf("%s: %s", e.name, lost.reason)
		}
		if err != nil {
			return nil, 0, nil, p.unanswered(e, err)
		}
		return raw, status, answerHeader, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, nil, fmt.Errorf("%s: invalid URL", e.name)
	}
	req.Header = header.Clone()
	res, err := p.http.Do(req)
	if err != nil {
		return nil, 0, nil, p.unanswered(e, err)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxAnswer+1))
	res.Body.Close()
	if err != nil {
		return nil, 0, nil, p.unanswered(e, err)
	}
	return raw, res.StatusCode, res.Header, nil
}

func answer(status int, body []byte) *http.Response {
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	return &http.Response{StatusCode: status, Status: fmt.Sprintf("%d %s", status, http.StatusText(status)), Header: header,
		Body: io.NopCloser(bytes.NewReader(body)), ContentLength: int64(len(body))}
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
// more than 10000 results" (Infura), "exceed maximum block range", "query exceeds max results 20000, retry with the
// range" (Arc) or "log response size exceeded". A timeout or other failure that only mentions a result is not one.
func tooLarge(m string) bool {
	return strings.Contains(m, "range") || strings.Contains(m, "results") || strings.Contains(m, "response size") ||
		strings.Contains(m, "result size") || strings.Contains(m, "too large") || strings.Contains(m, "too big")
}

// addressLimit reports a lowercase error message refusing a log query for the contracts it names, such as "a maximum of
// 10 addresses is allowed" (PublicNode).
// A rate limit that names the caller's IP address is not one, nor is a range or result refusal.
func addressLimit(m string) bool {
	return strings.Contains(m, "address") && !strings.Contains(m, "rate") && !tooLarge(m) &&
		(strings.Contains(m, "maximum") || strings.Contains(m, "too many") || strings.Contains(m, "limit") ||
			strings.Contains(m, "exceed"))
}

// Missing reports an answer that no endpoint has the block or state asked for (see missing), from the pool or a provider.
func Missing(err error) bool {
	var e rpc.Error
	return errors.As(err, &e) && (e.Error() == missing || lacksData(strings.ToLower(e.Error())))
}

// AddressesTooMany reports a log query refused for the number of contracts it names, by the pool or a provider.
func AddressesTooMany(err error) bool {
	var status rpc.HTTPError
	if errors.As(err, &status) {
		var answer struct{ Error *struct{ Message string } }
		return json.Unmarshal(status.Body, &answer) == nil && answer.Error != nil && addressLimit(strings.ToLower(answer.Error.Message))
	}
	var e rpc.Error
	return errors.As(err, &e) && addressLimit(strings.ToLower(e.Error()))
}

// batchLimit reports a lowercase error message refusing a batch's size, such as "batch of more than 3 requests are not
// allowed" or "batch size 101 exceeds limit of 100".
func batchLimit(m string) bool {
	return strings.Contains(m, "batch") && !strings.Contains(m, "rate") && (strings.Contains(m, "not allowed") ||
		strings.Contains(m, "too large") || strings.Contains(m, "maximum batch") || strings.Contains(m, "exceeds") ||
		strings.Contains(m, "limit"))
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
	limited := func(message string) bool { return batchLimit(strings.ToLower(message)) }
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
