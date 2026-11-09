// Package intents talks to NEAR Intents' 1Click API (D-123): its token list, quotes it signs, and swap status.
package intents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/outbound"
)

// maxAnswer bounds an answer: the token list is about 50 KiB.
const maxAnswer = 1 << 20

var (
	// ErrUnavailable: 1Click didn't answer, or answered with something other than a quote or a refusal.
	ErrUnavailable = errors.New("1Click unavailable")
	// ErrRefused: 1Click refused the request, as for a refund address it can't use.
	ErrRefused = errors.New("1Click refused the quote")
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
}

// NewClient refuses non-public addresses, as every client to a third party does; allowLoopback is for a test's fake.
func NewClient(url, key string, allowLoopback bool) *Client {
	c := outbound.Client(allowLoopback)
	c.Timeout = 20 * time.Second // a quote waits for solvers' answers
	return &Client{HTTP: c, URL: url, Key: key, Signer: ManagerKey}
}

var minimum = regexp.MustCompile(`try at least ([0-9]{1,78})`)

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
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
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
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer res.Body.Close()
	answer, err := io.ReadAll(io.LimitReader(res.Body, maxAnswer+1))
	if err != nil || len(answer) > maxAnswer {
		return nil, fmt.Errorf("%w: answer unreadable or over %d bytes", ErrUnavailable, maxAnswer)
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
		return nil, fmt.Errorf("%w: %.200s", ErrRefused, refusal.Message)
	default:
		return nil, fmt.Errorf("%w: status %d", ErrUnavailable, res.StatusCode)
	}
}
