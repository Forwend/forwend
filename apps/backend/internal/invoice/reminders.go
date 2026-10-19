package invoice

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

// Reminder steps (R-96, D-69), in the order they go out: 3 days before the due date, on it, 7 days after, in UTC days.
const (
	ReminderBefore = "before"
	ReminderDue    = "due"
	ReminderAfter  = "after"
)

var (
	// ErrDueDateRequired: reminders count from the due date, and the invoice has none.
	ErrDueDateRequired = errors.New("invoice has no due date")
	// ErrRemindersStopped: the client stopped the reminders, so the owner can't turn them on again.
	ErrRemindersStopped = errors.New("the client stopped the reminders")
)

// Reminders is an invoice's reminder state, for its owner: StoppedAt is zero until the client stops them.
type Reminders struct {
	On        bool
	StoppedAt time.Time
	Emails    []Send // each reminder queued, with its Step
}

var stopToken = regexp.MustCompile(`^[0-9a-f]{64}$`)

// PaidToOwnerSQL is the ledger's recipient_payable credits on the option row whose id is the SQL expression option:
// minus what the owner got. No settlement runs before the amount is all in, so on an invoice the payer can still pay,
// its amount plus this is what is left (R-95, R-96).
func PaidToOwnerSQL(option string) string {
	return `coalesce((SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id
		WHERE x.invoice_id = ` + option + ` AND e.account = 'recipient_payable'), 0)`
}

// SetReminders turns the profile's invoice's reminders on or off (R-96). On needs an invoice the payer can still pay,
// with a due date and a client email, whose client has not stopped them. The first call makes the stop token.
func (s *Service) SetReminders(ctx context.Context, profileID, id string, on bool) (Invoice, error) {
	id = strings.ToLower(id)
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var email, due, status string
		err := tx.QueryRow(ctx, "SELECT coalesce(client_email, ''), coalesce(due_date::text, ''), "+StatusFilterSQL+
			" FROM "+invoicesCurrent+" WHERE id = $1 AND profile_id = $2", id, profileID).Scan(&email, &due, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("read invoice %s: %w", id, err)
		}
		var stopped bool
		err = tx.QueryRow(ctx, "SELECT stopped_at IS NOT NULL FROM invoice_reminders WHERE invoice_id = $1 FOR UPDATE",
			id).Scan(&stopped)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read invoice %s reminders: %w", id, err)
		}
		switch {
		case !on:
		case stopped:
			return ErrRemindersStopped
		case status != "open":
			return ErrClosed
		case due == "":
			return ErrDueDateRequired
		case email == "":
			return ErrNoClientEmail
		}
		token, err := newStopToken()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO invoice_reminders (invoice_id, enabled, stop_token) VALUES ($1, $2, $3)
			ON CONFLICT (invoice_id) DO UPDATE SET enabled = $2`, id, on, token); err != nil {
			return fmt.Errorf("save invoice %s reminders: %w", id, err)
		}
		return nil
	})
	if err != nil {
		return Invoice{}, err
	}
	return s.GetOfProfile(ctx, profileID, id)
}

// newStopToken is the secret in the client's stop link: 32 random bytes in hex.
func newStopToken() (string, error) {
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return "", fmt.Errorf("make stop token: %w", err)
	}
	return hex.EncodeToString(token), nil
}

// StopReminders stops an invoice's reminders for good, by the token of the client's stop link (R-96). It answers the
// invoice's number and who sent it (the issuer, else the sender name), the same when already stopped. An unknown token
// is ErrNotFound.
func (s *Service) StopReminders(ctx context.Context, token string) (number int64, from string, err error) {
	if !stopToken.MatchString(token) {
		return 0, "", ErrNotFound
	}
	err = s.pool.QueryRow(ctx, `WITH r AS (UPDATE invoice_reminders SET stopped_at = coalesce(stopped_at, now())
		    WHERE stop_token = $1 RETURNING invoice_id)
		SELECT m.number, coalesce(m.issuer_name, m.sender_name, '') FROM r JOIN invoices m ON m.id = r.invoice_id`,
		token).Scan(&number, &from)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", ErrNotFound
	} else if err != nil {
		return 0, "", fmt.Errorf("stop reminders: %w", err)
	}
	return number, from, nil
}

// QueueReminders queues, for each invoice with reminders on and not stopped that the payer can still pay and that has
// a client email, the latest step whose UTC day has come, once per step: a step passed while the worker was down gives
// way to the later one. The worker calls it each round and the email worker sends them (R-96). A user's reminders fit
// in what is left of outbox.MaxClientEmails, earliest due first; the others wait for a later round (R-116).
func (s *Service) QueueReminders(ctx context.Context) error {
	// $1 to $4: the kind and the steps.
	due := `SELECT invoices.id, invoices.option_id, invoices.due_date, s.step, p.user_id
		FROM invoice_reminders r JOIN ` + invoicesCurrent + ` ON invoices.id = r.invoice_id
		JOIN profiles p ON p.id = invoices.profile_id
		CROSS JOIN LATERAL (SELECT v.step FROM (VALUES ($2::text, -3, 0), ($3::text, 0, 1), ($4::text, 7, 2)) v (step, days, rank)
		    WHERE invoices.due_date + v.days <= (now() AT TIME ZONE 'UTC')::date ORDER BY v.rank DESC LIMIT 1) s
		WHERE r.enabled AND r.stopped_at IS NULL AND invoices.client_email IS NOT NULL AND ` + StatusFilterSQL + ` = 'open'
		  AND NOT EXISTS (SELECT 1 FROM outbox_events o WHERE o.invoice_id = invoices.id AND o.kind = $1
		                  AND o.payload->>'step' = s.step)`
	args := []any{outbox.Reminder, ReminderBefore, ReminderDue, ReminderAfter}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// The users' rows, as outbox.ClientEmailsLeft locks them, so a Send to client at once counts after these.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id IN (SELECT user_id FROM (`+due+`) d) ORDER BY id
			FOR UPDATE`, args...); err != nil {
			return fmt.Errorf("lock reminder users: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO outbox_events (kind, invoice_id, payload)
			SELECT $1, d.id, jsonb_build_object('option', d.option_id, 'step', d.step)
			FROM (SELECT d.*, row_number() OVER (PARTITION BY d.user_id ORDER BY d.due_date, d.id) AS n
			      FROM (`+due+`) d) d
			LEFT JOIN (`+outbox.ClientEmailsSQL+`) c ON c.user_id = d.user_id
			WHERE d.n <= $5 - coalesce(c.sent, 0)
			ON CONFLICT (invoice_id, (payload->>'step')) WHERE kind = 'invoice.reminder' DO NOTHING`,
			append(args, outbox.MaxClientEmails)...); err != nil {
			return fmt.Errorf("queue reminders: %w", err)
		}
		return nil
	})
}

// reminders reads the invoice's reminder state and the reminders queued for it.
func (s *Service) reminders(ctx context.Context, id string) (Reminders, error) {
	var r Reminders
	var stopped *time.Time
	err := s.pool.QueryRow(ctx, "SELECT enabled, stopped_at FROM invoice_reminders WHERE invoice_id = $1", id).
		Scan(&r.On, &stopped)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Reminders{}, fmt.Errorf("read invoice %s reminders: %w", id, err)
	}
	if stopped != nil {
		r.StoppedAt = stopped.UTC()
	}
	r.Emails, err = s.emails(ctx, id, outbox.Reminder)
	return r, err
}
