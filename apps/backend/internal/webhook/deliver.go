package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

// Retries are the waits before each attempt after the first: Svix's schedule, its last step repeated to about 3 days
// (D-98).
var Retries = []time.Duration{5 * time.Second, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour, 5 * time.Hour,
	10 * time.Hour, 10 * time.Hour, 10 * time.Hour, 10 * time.Hour, 10 * time.Hour, 10 * time.Hour}

// Why Forwend turns an endpoint off.
const (
	Gone    = "gone"    // it answered 410
	Failing = "failing" // a delivery failed its last attempt
)

const (
	// Batch bounds the deliveries one round sends at once.
	Batch = 16
	// lease keeps a claimed delivery from the next round while its attempt runs; a process that stops mid-attempt
	// leaves it to be sent again after this.
	lease = time.Minute
)

// Body is an event's body. cmd/webhooks gives invoiceapi.EventBody with the invoice as its owner reads it.
type Body func(ctx context.Context, e Event) ([]byte, error)

type delivery struct {
	endpointID, eventID, profileID, url, body string
	attempts                                  int
}

// Deliver sends the due deliveries once, each signed by every working secret of its endpoint. Without
// WEBHOOK_SECRET_KEY nothing can be signed, so nothing is sent.
func (s *Service) Deliver(ctx context.Context, client *http.Client, body Body) error {
	if s.key == nil {
		return nil
	}
	rows, err := s.pool.Query(ctx, `UPDATE webhook_deliveries d SET next_attempt_at = now() + $2 * interval '1 second'
		FROM (SELECT d.endpoint_id, d.event_id FROM webhook_deliveries d JOIN webhook_endpoints w ON w.id = d.endpoint_id
		      WHERE d.status = 'pending' AND d.next_attempt_at <= now() AND w.enabled
		      ORDER BY d.next_attempt_at LIMIT $1 FOR UPDATE OF d SKIP LOCKED) c, webhook_endpoints w
		WHERE d.endpoint_id = c.endpoint_id AND d.event_id = c.event_id AND w.id = d.endpoint_id
		RETURNING d.endpoint_id::text, d.event_id, w.profile_id::text, w.url, coalesce(d.body, ''), d.attempts`,
		Batch, int64(lease.Seconds()))
	if err != nil {
		return fmt.Errorf("claim webhook deliveries: %w", err)
	}
	claimed, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (delivery, error) {
		var d delivery
		err := row.Scan(&d.endpointID, &d.eventID, &d.profileID, &d.url, &d.body, &d.attempts)
		return d, err
	})
	if err != nil {
		return fmt.Errorf("claim webhook deliveries: %w", err)
	}
	errs := make([]error, len(claimed))
	var wg sync.WaitGroup
	for i, d := range claimed {
		wg.Go(func() { errs[i] = s.attempt(ctx, client, body, d) })
	}
	wg.Wait()
	return errors.Join(errs...)
}

// attempt sends one delivery and records the answer. An error before the request leaves the delivery to its lease.
func (s *Service) attempt(ctx context.Context, client *http.Client, body Body, d delivery) error {
	// Secrets first: the body is built when it can be sent (D-97).
	secrets, err := s.secrets(ctx, s.pool, d.profileID, d.endpointID)
	if err != nil {
		return fmt.Errorf("read endpoint %s secrets: %w", d.endpointID, err)
	}
	if d.body == "" {
		e, err := s.Event(ctx, d.eventID)
		if err != nil {
			return err
		}
		var b []byte
		if e.Type == Test {
			b, err = json.Marshal(struct {
				ID        string   `json:"id"`
				Type      string   `json:"type"`
				Livemode  bool     `json:"livemode"`
				Timestamp string   `json:"timestamp"`
				Data      struct{} `json:"data"`
			}{ID: e.ID, Type: e.Type, Livemode: e.Livemode, Timestamp: e.CreatedAt.UTC().Format(time.RFC3339)})
		} else {
			b, err = body(ctx, e)
		}
		if err != nil {
			return fmt.Errorf("build webhook event %s: %w", d.eventID, err)
		}
		// Another round may have built it first: every attempt sends the first body.
		if err := s.pool.QueryRow(ctx, `UPDATE webhook_deliveries SET body = coalesce(body, $3)
			WHERE endpoint_id = $1 AND event_id = $2 RETURNING body`, d.endpointID, d.eventID, string(b)).
			Scan(&d.body); err != nil {
			return fmt.Errorf("keep webhook event %s body: %w", d.eventID, err)
		}
	}
	texts := make([]string, len(secrets))
	for i, sec := range secrets {
		texts[i] = sec.Text
	}
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.url, bytes.NewReader([]byte(d.body)))
	if err != nil {
		return fmt.Errorf("webhook request for endpoint %s: %w", d.endpointID, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Forwend-Webhooks/1")
	req.Header.Set("webhook-id", d.eventID)
	req.Header.Set("webhook-timestamp", strconv.FormatInt(start.Unix(), 10))
	req.Header.Set("webhook-signature", sign(texts, d.eventID, start.Unix(), []byte(d.body)))
	code, failure := 0, ""
	resp, err := client.Do(req)
	if err != nil {
		failure = reason(err)
	} else {
		code = resp.StatusCode
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10)) // lets the connection be used again
		resp.Body.Close()
		if code >= 300 && code < 400 {
			failure = "redirects are not followed"
		}
	}
	return s.record(ctx, d, code, failure, time.Since(start))
}

// reason is an attempt's error without the URL, which may hold the receiver's own token.
func reason(err error) string {
	var u *url.Error
	switch {
	case errors.Is(err, errNotPublic):
		return errNotPublic.Error()
	case errors.As(err, &u) && u.Timeout():
		return "timeout"
	case errors.As(err, &u):
		err = u.Err
	}
	text := err.Error()
	if len(text) > 300 {
		// A cut through a character would leave bytes Postgres refuses, and the attempt would go unlogged.
		text = strings.ToValidUTF8(text[:300], "")
	}
	return text
}

// record logs the attempt and moves the delivery on: done on a 2xx, again later on the schedule, or failed. A 410 or
// a last failure turns the endpoint off and emails its owner once.
func (s *Service) record(ctx context.Context, d delivery, code int, failure string, took time.Duration) error {
	n := d.attempts + 1
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO webhook_attempts (endpoint_id, event_id, status_code, error, duration_ms)
			VALUES ($1, $2, nullif($3, 0), nullif($4, ''), $5)`, d.endpointID, d.eventID, code, failure,
			took.Milliseconds()); err != nil {
			return fmt.Errorf("log webhook attempt: %w", err)
		}
		status, next, off := "pending", time.Duration(0), ""
		switch {
		case code >= 200 && code < 300:
			status = "succeeded"
		case code == http.StatusGone:
			status, off = "failed", Gone
		case n > len(Retries):
			status, off = "failed", Failing
		default:
			next = Retries[n-1]
		}
		if status != "succeeded" {
			slog.Warn("webhook attempt failed", "endpoint", d.endpointID, "event", d.eventID, "attempt", n,
				"status", code, "err", failure)
		}
		if _, err := tx.Exec(ctx, `UPDATE webhook_deliveries SET status = $3, attempts = $4,
			    next_attempt_at = now() + $5 * interval '1 millisecond', updated_at = now()
			WHERE endpoint_id = $1 AND event_id = $2`, d.endpointID, d.eventID, status, n, next.Milliseconds()); err != nil {
			return fmt.Errorf("record webhook delivery: %w", err)
		}
		if off == "" {
			return nil
		}
		payload, _ := json.Marshal(outbox.Payload{Reason: off}) // only strings: it can't fail
		_, err := tx.Exec(ctx, `WITH w AS (UPDATE webhook_endpoints SET enabled = false, updated_at = now()
			    WHERE id = $1 AND enabled RETURNING id)
			INSERT INTO outbox_events (kind, endpoint_id, payload) SELECT $2, id, $3 FROM w`,
			d.endpointID, outbox.WebhookDisabled, payload)
		if err != nil {
			return fmt.Errorf("turn endpoint %s off: %w", d.endpointID, err)
		}
		return nil
	})
}
