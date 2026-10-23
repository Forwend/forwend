// Package outbox queues the events the worker sends as email (R-80): one row per event, written in the transaction
// that makes the change, so an event is never lost or sent for a change that rolled back.
package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
)

// Event kinds, as the outbox_events check allows.
const (
	Paid    = "invoice.paid"
	Settled = "invoice.settled"
	Held    = "invoice.held"    // money held for the payer: an excess, an expired partial payment, a late deposit, one after cancel or on another option
	Receipt = "invoice.receipt" // the payer's receipt, to the address they gave (R-82); at most one per invoice
	Welcome = "account.welcome" // a new account's welcome, to its login email (R-84); at most one per user
	Sent    = "invoice.sent"    // the invoice, to its client's email when the owner presses Send to client (R-94)
	// A payment reminder to the client's email (R-96); at most one per invoice and step.
	Reminder = "invoice.reminder"
	Change   = "job.change" // a scope change, to the email the client typed accepting the job (R-107)
)

// MaxClientEmails caps a user's client emails (Sent, reminders, job changes) in any 24 hours (R-116), so one account
// can't mail strangers in bulk through Forwend or spend the shared Resend budget (D-65) for the money emails.
const MaxClientEmails = 20

const ClientEmailsSQL = `SELECT p.user_id, count(*) AS sent, min(e.created_at) AS oldest FROM outbox_events e
	LEFT JOIN invoices i ON i.id = e.invoice_id LEFT JOIN jobs j ON j.id = e.job_id
	JOIN profiles p ON p.id = coalesce(i.profile_id, j.profile_id)
	WHERE e.kind IN ('` + Sent + `', '` + Reminder + `', '` + Change + `') AND e.created_at > now() - interval '24 hours'
	GROUP BY p.user_id`

// ClientEmailsLeft locks the profile's user row, so the user's client emails count one after the other, and says how
// many more may be queued now and, when none, how long until the oldest counted one is a day old.
func ClientEmailsLeft(ctx context.Context, tx pgx.Tx, profileID string) (left int, wait time.Duration, err error) {
	var user string
	if err := tx.QueryRow(ctx, "SELECT u.id FROM users u JOIN profiles p ON p.user_id = u.id WHERE p.id = $1 FOR NO KEY UPDATE OF u",
		profileID).Scan(&user); err != nil {
		return 0, 0, fmt.Errorf("lock profile %s user: %w", profileID, err)
	}
	var sent int
	if err := tx.QueryRow(ctx, `SELECT coalesce(c.sent, 0), coalesce(c.oldest + interval '24 hours' - now(), interval '0')
		FROM (SELECT $1::uuid AS user_id) u LEFT JOIN (`+ClientEmailsSQL+`) c USING (user_id)`, user).
		Scan(&sent, &wait); err != nil {
		return 0, 0, fmt.Errorf("count user %s client emails: %w", user, err)
	}
	return max(MaxClientEmails-sent, 0), wait, nil
}

type Payload struct {
	Option string `json:"option"`
	Amount string `json:"amount,omitempty"`
	Step   string `json:"step,omitempty"`
	Change string `json:"change,omitempty"`
}

// QueueReceipt queues at most one receipt, and only once the payer gave an address (R-82).
func QueueReceipt(ctx context.Context, tx pgx.Tx, option string) error {
	payload, err := json.Marshal(Payload{Option: option})
	if err != nil {
		return fmt.Errorf("queue receipt for %s: %w", option, err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO outbox_events (kind, invoice_id, payload)
		SELECT $1, m.id, $3 FROM invoices o JOIN invoices m ON m.id = coalesce(o.main_id, o.id)
		WHERE o.id = $2 AND m.payer_email IS NOT NULL
		ON CONFLICT (invoice_id) WHERE kind = 'invoice.receipt' DO NOTHING`, Receipt, option, payload); err != nil {
		return fmt.Errorf("queue receipt for %s: %w", option, err)
	}
	return nil
}

// QueueSend adds the owner's Send to client for the invoice's main row, under the request's Idempotency-Key (R-94).
func QueueSend(ctx context.Context, tx pgx.Tx, invoice, key string) error {
	payload, err := json.Marshal(Payload{Option: invoice})
	if err != nil {
		return fmt.Errorf("queue send for %s: %w", invoice, err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO outbox_events (kind, invoice_id, payload, idempotency_key) VALUES ($1, $2, $3, $4)`,
		Sent, invoice, payload, key); err != nil {
		return fmt.Errorf("queue send for %s: %w", invoice, err)
	}
	return nil
}

// Queue adds an event for the invoice that option belongs to. amount may be nil.
func Queue(ctx context.Context, tx pgx.Tx, kind, option string, amount *big.Int) error {
	p := Payload{Option: option}
	if amount != nil {
		p.Amount = amount.String()
	}
	payload, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("queue %s for %s: %w", kind, option, err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO outbox_events (kind, invoice_id, payload)
		SELECT $1, coalesce(main_id, id), $3 FROM invoices WHERE id = $2`, kind, option, payload); err != nil {
		return fmt.Errorf("queue %s for %s: %w", kind, option, err)
	}
	return nil
}

// QueueChange adds the email of the job's scope change under key (R-107).
func QueueChange(ctx context.Context, tx pgx.Tx, job, key string) error {
	payload, err := json.Marshal(Payload{Change: key})
	if err != nil {
		return fmt.Errorf("queue change for job %s: %w", job, err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO outbox_events (kind, job_id, payload) VALUES ($1, $2, $3)", Change, job,
		payload); err != nil {
		return fmt.Errorf("queue change for job %s: %w", job, err)
	}
	return nil
}
