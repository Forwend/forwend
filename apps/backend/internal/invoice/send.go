package invoice

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

// Send to client limit (R-94): the owner picks the address, so this stops the button from mailing a client again and
// again; outbox.MaxClientEmails caps the user's client emails of every kind (R-116).
const SendEvery = 24 * time.Hour

var (
	// ErrNoClientEmail: the invoice has no client email to send it to.
	ErrNoClientEmail = errors.New("invoice has no client email")
	// ErrClosed: the payer can no longer pay the invoice: paid, settled, expired, its checkout closed, or canceled.
	ErrClosed = errors.New("invoice is closed")
)

// Send is one email to the client, a Send to client or a reminder (with its Step): when it was queued, and when the
// worker sent it or gave up; zero until then.
type Send struct {
	Step                          string
	RequestedAt, SentAt, FailedAt time.Time
}

// Send queues one email of the profile's invoice to its client's email (R-94), once per (profile, idempotency key):
// queued is false when the same key already did. Only while the payer can still pay it (StatusFilterSQL open). allow
// is the limit shared by everyone, asked last, so a refused request uses none of it. It locks the profile row, as
// Create does; outbox.ClientEmailsLeft then locks the user's row, so the user's client emails count one after the
// other.
func (s *Service) Send(ctx context.Context, profileID, id, key string, allow func() time.Duration) (inv Invoice,
	queued bool, err error) {
	id = strings.ToLower(id)
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE", profileID); err != nil {
			return fmt.Errorf("lock profile %s: %w", profileID, err)
		}
		var keyed string
		err := tx.QueryRow(ctx, `SELECT e.invoice_id FROM outbox_events e JOIN invoices m ON m.id = e.invoice_id
			WHERE m.profile_id = $1 AND e.kind = $2 AND e.idempotency_key = $3`, profileID, outbox.Sent, key).Scan(&keyed)
		if err == nil && keyed != id {
			return ErrConflict
		} else if err == nil {
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read invoice %s send: %w", id, err)
		}
		var email, status string
		err = tx.QueryRow(ctx, "SELECT coalesce(client_email, ''), "+StatusFilterSQL+" FROM "+invoicesCurrent+
			" WHERE id = $1 AND profile_id = $2", id, profileID).Scan(&email, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("read invoice %s: %w", id, err)
		}
		if email == "" {
			return ErrNoClientEmail
		}
		if status != "open" {
			return ErrClosed
		}
		var wait time.Duration
		if err := tx.QueryRow(ctx, `SELECT coalesce(max(created_at) + make_interval(secs => $3) - now(), interval '0')
			FROM outbox_events WHERE invoice_id = $1 AND kind = $2 AND created_at > now() - make_interval(secs => $3)`,
			id, outbox.Sent, SendEvery.Seconds()).Scan(&wait); err != nil {
			return fmt.Errorf("read invoice %s last send: %w", id, err)
		}
		if wait > 0 {
			return &TooSoonError{Wait: wait}
		}
		left, wait, err := outbox.ClientEmailsLeft(ctx, tx, profileID)
		if err != nil {
			return err
		} else if left == 0 {
			return &TooSoonError{Wait: wait}
		}
		if wait := allow(); wait > 0 {
			return &TooSoonError{Wait: wait}
		}
		queued = true
		return outbox.QueueSend(ctx, tx, id, key)
	})
	if err != nil {
		return Invoice{}, false, err
	}
	inv, err = s.GetOfProfile(ctx, profileID, id)
	return inv, queued, err
}

// emails reads the invoice's outbox rows of kind (Send to client or reminders), oldest first.
func (s *Service) emails(ctx context.Context, id, kind string) ([]Send, error) {
	rows, err := s.pool.Query(ctx, `SELECT coalesce(payload->>'step', ''), created_at, published_at, failed_at
		FROM outbox_events WHERE invoice_id = $1 AND kind = $2 ORDER BY id`, id, kind)
	if err != nil {
		return nil, fmt.Errorf("read invoice %s %s emails: %w", id, kind, err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Send, error) {
		var step string
		var requested time.Time
		var sent, failed *time.Time
		err := row.Scan(&step, &requested, &sent, &failed)
		out := Send{Step: step, RequestedAt: requested.UTC()}
		if sent != nil {
			out.SentAt = sent.UTC()
		}
		if failed != nil {
			out.FailedAt = failed.UTC()
		}
		return out, err
	})
}
