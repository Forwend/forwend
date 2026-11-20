package chain

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/rpc"
)

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
		return nil, refusal{res: res, missing: true}
	}
	// Only answers count toward the answer time: a fast error must not make an endpoint look fast.
	p.measured(e, took)
	if r, _ := parseRequest(body); r.blocks > 0 && bytes.Contains(safe, []byte(`"log result size too large"`)) {
		return nil, refusal{res: res}
	}
	return res, nil
}

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

type retryAfter struct {
	error
	delay time.Duration
}

func retryDelay(raw string) time.Duration {
	if seconds, err := strconv.ParseInt(raw, 10, 64); err == nil {
		if seconds < 0 {
			return 0
		}
		if seconds >= int64(restMax/time.Second) {
			return restMax
		}
		return time.Duration(seconds) * time.Second
	}
	if at, err := http.ParseTime(raw); err == nil {
		return min(restMax, max(0, time.Until(at)))
	}
	return 0
}

// lasting is a failure that doesn't heal in seconds: its endpoint rests restMax at once.
type lasting struct{ error }

// Network errors may contain the entire URL or reflected credentials; return only a safe category.
func (p *pool) unanswered(e *endpoint, err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return hostDown{fmt.Errorf("%s: timeout: %w", e.name, context.DeadlineExceeded)}
	}
	return hostDown{fmt.Errorf("%s: connection failed", e.name)}
}

// hostDown is a request its host didn't answer (timeout, refused or broken connection): the host's endpoints rest.
type hostDown struct{ error }

func (h hostDown) Unwrap() error { return h.error }
