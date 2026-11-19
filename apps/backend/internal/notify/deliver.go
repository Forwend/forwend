// Package notify sends the email for each outbox event (R-80, R-82, R-84, R-94, R-96, R-107, R-148), each under one Resend
// Idempotency-Key on every retry, so a lost answer sends nothing twice. Nothing logs an address, a subject or a body.
package notify

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/email"
	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// With Backoff, MaxAttempts ends within a few hours, inside Resend's 24-hour idempotency window.
const MaxAttempts = 10

// Batch bounds the events one call sends, so a backlog never holds up the worker's chain rounds.
const Batch = 20

func Backoff(n int) time.Duration {
	return min(time.Minute<<min(n-1, 6), time.Hour)
}

func Deliver(ctx context.Context, pool *pgxpool.Pool, sender email.Sender, site Site) error {
	for range Batch {
		more, err := deliverOne(ctx, pool, sender, site)
		if err != nil || !more {
			return err
		}
	}
	return nil
}

// dropToken removes an invite's link token from its row once the email is sent, skipped or given up: then only its
// hash is left (R-139).
const dropToken = "payload = payload - 'token'"

// event is an outbox row; the ids it isn't about are "" or 0.
type event struct {
	id                                         int64
	kind, invoice, user, job, invite, endpoint string
	transfer                                   int64
	payload                                    outbox.Payload
	attempts                                   int
}

// deliverOne sends the oldest due event; false when none is due or a send fails other than by refusal.
func deliverOne(ctx context.Context, pool *pgxpool.Pool, sender email.Sender, site Site) (bool, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("deliver email: %w", err)
	}
	defer tx.Rollback(ctx)
	var e event
	var payload []byte
	err = tx.QueryRow(ctx, `SELECT id, kind, coalesce(invoice_id, ''), coalesce(user_id::text, ''),
		    coalesce(job_id::text, ''), coalesce(invite_id::text, ''), coalesce(endpoint_id::text, ''),
		    coalesce(wallet_transfer_id, 0), payload, attempts
		FROM outbox_events WHERE published_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
		ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&e.id, &e.kind, &e.invoice, &e.user, &e.job, &e.invite,
		&e.endpoint, &e.transfer, &payload, &e.attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	} else if err != nil {
		return false, fmt.Errorf("claim email event: %w", err)
	}
	if err := json.Unmarshal(payload, &e.payload); err != nil {
		return failed(ctx, tx, e, fmt.Errorf("read email event %d: %w", e.id, err), true)
	}
	// A read that fails rolls back to here, so the claim's transaction can still record the failed try.
	sp, err := tx.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("deliver email: %w", err)
	}
	v, to, on, scope, err := read(ctx, sp, e, site.WebURL)
	if err != nil {
		if err := sp.Rollback(ctx); err != nil {
			return false, fmt.Errorf("deliver email: %w", err)
		}
		return failed(ctx, tx, e, fmt.Errorf("read email event %d: %w", e.id, err), true)
	}
	if err := sp.Commit(ctx); err != nil {
		return false, fmt.Errorf("deliver email: %w", err)
	}
	if !on || to == nil || *to == "" {
		// Email off for this profile, or no login email ('' when the account has none; NULL when it was never read):
		// nothing to send, and nothing waits for it.
		if _, err := tx.Exec(ctx, "UPDATE outbox_events SET published_at = now(), "+dropToken+" WHERE id = $1",
			e.id); err != nil {
			return false, fmt.Errorf("skip email event %d: %w", e.id, err)
		}
		return true, tx.Commit(ctx)
	}
	m, err := message(site, v)
	if err != nil {
		return failed(ctx, tx, e, fmt.Errorf("render email event %d: %w", e.id, err), true)
	}
	m.To = *to
	// The key holds the invoice, user or job id because event ids restart in another database sharing the Resend team,
	// and a hash of the address and the message because Resend refuses a key it already saw with another body: an
	// invoice edited between two tries changes it.
	sum := sha256.Sum256(fmt.Appendf(nil, "%q|%q|%q|%q|%q|%q", m.To, m.Subject, m.Text, m.HTML, m.ReplyTo, m.Unsubscribe))
	m.Key = fmt.Sprintf("forwend-%s-%d-%x", scope, e.id, sum[:8])
	if sent := sender.Send(ctx, m); sent != nil {
		// Any send failure other than a refusal stops the round, so a failing or hanging Resend doesn't hold up the
		// worker's chain rounds.
		return failed(ctx, tx, e, sent, errors.Is(sent, email.ErrRefused))
	}
	if _, err := tx.Exec(ctx, "UPDATE outbox_events SET attempts = attempts + 1, published_at = now(), "+dropToken+
		" WHERE id = $1", e.id); err != nil {
		return false, fmt.Errorf("record email event %d: %w", e.id, err)
	}
	if err := addHistory(ctx, tx, e, false); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

// failed counts a failed try with Backoff and gives up after MaxAttempts; next says whether the round goes on. A refused
// message or an event that can't be read or rendered must not hold up every email behind it (R-115).
func failed(ctx context.Context, tx pgx.Tx, e event, cause error, next bool) (bool, error) {
	attempts := e.attempts + 1
	var err error
	if attempts >= MaxAttempts {
		slog.Error("email given up", "event", e.id, "kind", e.kind, "attempts", attempts, "err", cause)
		_, err = tx.Exec(ctx, "UPDATE outbox_events SET attempts = $2, failed_at = now(), "+dropToken+" WHERE id = $1",
			e.id, attempts)
		if err == nil {
			err = addHistory(ctx, tx, e, true)
		}
	} else {
		slog.Warn("email failed; trying again later", "event", e.id, "kind", e.kind, "attempt", attempts, "err", cause)
		_, err = tx.Exec(ctx, "UPDATE outbox_events SET attempts = $2, next_attempt_at = now() + $3 WHERE id = $1",
			e.id, attempts, Backoff(attempts))
	}
	if err != nil {
		return false, fmt.Errorf("record email event %d failure: %w", e.id, err)
	}
	return next, tx.Commit(ctx)
}

// The client's and payer's emails go in the invoice's history (R-126): sent, or failed once given up.
var emailed = map[string]struct{ sent, failed string }{
	outbox.Sent:     {history.InvoiceEmailed, history.InvoiceEmailFailed},
	outbox.Reminder: {history.ReminderEmailed, history.ReminderEmailFailed},
	outbox.Receipt:  {history.ReceiptEmailed, history.ReceiptEmailFailed},
}

func addHistory(ctx context.Context, tx pgx.Tx, e event, failed bool) error {
	h, ok := emailed[e.kind]
	if !ok {
		return nil
	}
	k := h.sent
	if failed {
		k = h.failed
	}
	return history.Add(ctx, tx, e.invoice, k, cmp.Or(e.payload.By, history.System), history.Data{Step: e.payload.Step})
}
