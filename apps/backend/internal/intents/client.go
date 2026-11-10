// Package intents talks to NEAR Intents' 1Click API (D-123): its token list, quotes it signs, and swap status.
package intents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/outbound"
)

// maxAnswer bounds an answer: the token list is about 50 KiB.
const maxAnswer = 1 << 20

var (
	// errUnavailable: 1Click didn't answer, or answered with something other than a quote or a refusal.
	errUnavailable = errors.New("1Click unavailable")
	// ErrRefused: 1Click refused the request, as for a refund address it can't use.
	ErrRefused = errors.New("1Click refused the quote")
	// ErrNoLiquidity: a refusal for want of liquidity on the token's route (R-245); it is an ErrRefused too.
	ErrNoLiquidity = errors.New("no liquidity")
)

// BelowMinimum: the route needs at least Minimum of the destination asset, more than was asked.
type BelowMinimum struct{ Minimum string }

func (e *BelowMinimum) Error() string { return "below the route's minimum of " + e.Minimum }

// Client calls 1Click. Key is the optional partner key (Q-18): never log it. Signer is the key quotes must be signed
// with: ManagerKey, or a test fake's.
type Client struct {
	HTTP   *http.Client
	URL    string
	Key    string
	Signer string
	// rejected: 1Click's last answer refused Key, so its alert is logged once, not at every call.
	rejected atomic.Bool
}

// NewClient refuses non-public addresses, as every client to a third party does; allowLoopback is for a test's fake.
func NewClient(url, key string, allowLoopback bool) *Client {
	c := outbound.Client(allowLoopback)
	// A quote waits for solvers' answers before 1Click sends its headers.
	c.Transport.(*http.Transport).ResponseHeaderTimeout = 20 * time.Second
	c.Timeout = 25 * time.Second
	return &Client{HTTP: c, URL: url, Key: key, Signer: ManagerKey}
}

var (
	minimum = regexp.MustCompile(`try at least ([0-9]{1,78})`)
	// 1Click's temporary limits name dollars; the destination is Base USDC (D-123), a dollar for each 10^6 units.
	minimumUSD = regexp.MustCompile(`minimum swap amount is \$([0-9][0-9,]{0,30}(?:\.[0-9]{1,6})?)`)
	// 1Click's answer when no solver quotes the route: "No liquidity available".
	noLiquidity = regexp.MustCompile(`(?i)no liquidity`)
)

// call sends body (nil for a GET) and returns the answer's bytes, exactly as 1Click sent them.
func (c *Client) call(ctx context.Context, method, path string, body any) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.URL+path, reader)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errUnavailable, err)
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Key != "" {
		req.Header.Set("X-API-Key", c.Key)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errUnavailable, err)
	}
	defer res.Body.Close()
	answer, err := io.ReadAll(io.LimitReader(res.Body, maxAnswer+1))
	if err != nil || len(answer) > maxAnswer {
		return nil, fmt.Errorf("%w: answer unreadable or over %d bytes", errUnavailable, maxAnswer)
	}
	if res.StatusCode == http.StatusUnauthorized {
		if c.rejected.CompareAndSwap(false, true) {
			slog.Error("ALERT 1Click rejected the API key: no payer can get a quote")
		}
	} else {
		c.rejected.Store(false)
	}
	switch {
	case res.StatusCode == http.StatusOK || res.StatusCode == http.StatusCreated:
		return answer, nil
	case res.StatusCode == http.StatusBadRequest:
		var refusal struct{ Message string }
		_ = json.Unmarshal(answer, &refusal)
		if m := minimum.FindStringSubmatch(refusal.Message); m != nil {
			return nil, &BelowMinimum{Minimum: m[1]}
		}
		if m := minimumUSD.FindStringSubmatch(refusal.Message); m != nil {
			usd, _ := new(big.Rat).SetString(strings.ReplaceAll(m[1], ",", ""))
			return nil, &BelowMinimum{Minimum: new(big.Rat).Mul(usd, big.NewRat(1_000_000, 1)).FloatString(0)}
		}
		if noLiquidity.MatchString(refusal.Message) {
			return nil, fmt.Errorf("%w, %w: %.200s", ErrRefused, ErrNoLiquidity, refusal.Message)
		}
		return nil, fmt.Errorf("%w: %.200s", ErrRefused, refusal.Message)
	default:
		return nil, fmt.Errorf("%w: status %d", errUnavailable, res.StatusCode)
	}
}
