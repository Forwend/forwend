package chain

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
)

const (
	// attemptTimeout bounds one request to one endpoint: a slower endpoint rests and the request moves on.
	attemptTimeout = 5 * time.Second
	restBase       = time.Second
	restMax        = 5 * time.Minute
	RequestTimeout = 30 * time.Second
	healthInterval = 30 * time.Second
	// measureMemory: an endpoint unused this long is measured afresh, so one slow answer doesn't bench it for good.
	measureMemory = 10 * time.Minute
	// refusalMemory: an endpoint whose plan changed is tried with larger requests again after this.
	refusalMemory = time.Hour
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
	// The smallest log range, batch and address list it refused, forgotten after refusalMemory.
	refusedBlocks    uint64
	refusedCalls     int
	refusedAddresses int
	refusedAt        time.Time
}

// cost is how long an answer is expected to take once the endpoint is free; unmeasured endpoints cost nothing, so
// each gets measured.
func (e *endpoint) cost(now time.Time) time.Duration {
	if now.Sub(e.usedAt) > measureMemory {
		return 0
	}
	return time.Duration(float64(e.latency) * (1 + 4*e.failRate))
}

func (e *endpoint) refuses(r request, now time.Time) bool {
	if e.sock != nil && r.calls > socketBatch {
		return true
	}
	if now.Sub(e.refusedAt) > refusalMemory {
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
	if now.Sub(e.refusedAt) > refusalMemory {
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
		if !best.checked || best.failures > 0 || now.Sub(best.checkedAt) >= healthInterval {
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

func (p *pool) resting(e *endpoint) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return e.restUntil.After(time.Now())
}

// restFor's second half is random (0 ≤ jitter < 1) so endpoints that failed together don't come back at once.
func restFor(failures int, jitter float64) time.Duration {
	d := restMax
	if failures <= 16 {
		d = min(restMax, restBase<<(failures-1))
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

// measured keeps a moving average of the endpoint's answer time; one that sat unused starts again.
func (p *pool) measured(e *endpoint, took time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	if now.Sub(e.usedAt) > measureMemory {
		e.latency = took
	} else {
		e.latency = (4*e.latency + took) / 5
	}
	e.usedAt = now
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
