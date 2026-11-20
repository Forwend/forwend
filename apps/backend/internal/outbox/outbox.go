// Package outbox queues emails in the transaction that makes the change, so none is lost or sent for a rollback.
package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

// Event kinds, as the outbox_events check allows.
const (
	Paid            = "invoice.paid"
	Settled         = "invoice.settled"
	Held            = "invoice.held"
	Receipt         = "invoice.receipt" // at most one per invoice
	Welcome         = "account.welcome" // at most one per user
	Sent            = "invoice.sent"
	Reminder        = "invoice.reminder" // at most one per invoice and step
	Change          = "job.change"
	Invite          = "team.invite"
	WebhookDisabled = "webhook.disabled"
	SettleWaiting   = "settlement.waiting" // at most one a day per user
	WalletOutflow   = "wallet.outflow"     // money left with no send the owner approved
	RetainerFailed  = "retainer.failed"
)

// MaxClientEmails caps a user's client emails per 24 hours, so no one bulk-mails strangers through Forwend.
const MaxClientEmails = 20

const ClientEmailsSQL = `SELECT p.user_id, count(*) AS sent, min(e.created_at) AS oldest FROM outbox_events e
	LEFT JOIN invoices i ON i.id = e.invoice_id LEFT JOIN jobs j ON j.id = e.job_id
	LEFT JOIN profile_invites v ON v.id = e.invite_id
	JOIN profiles p ON p.id = coalesce(i.profile_id, j.profile_id, v.profile_id)
	WHERE e.kind IN ('` + Sent + `', '` + Reminder + `', '` + Change + `', '` + Invite + `')
	  AND e.created_at > now() - interval '24 hours'
	GROUP BY p.user_id`

// ClientEmailsLeft locks the user row so counts serialize; when none is left, wait is until one frees up.
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

// Payload holds only strings, so json.Marshal of it can't fail.
type Payload struct {
	Option string        `json:"option"`
	Amount string        `json:"amount,omitempty"`
	Step   string        `json:"step,omitempty"`
	Change string        `json:"change,omitempty"`
	By     history.Actor `json:"by,omitempty"`
	Token  string        `json:"token,omitempty"`  // the only copy; dropped once the email is done
	Reason string        `json:"reason,omitempty"` // webhook.Gone or webhook.Failing
	Due    string        `json:"due,omitempty"`    // YYYY-MM-DD
}

// QueueReceipt queues at most one receipt, and only once the payer gave an address.
func QueueReceipt(ctx context.Context, tx pgx.Tx, option string) error {
	payload, _ := json.Marshal(Payload{Option: option})
	if _, err := tx.Exec(ctx, `INSERT INTO outbox_events (kind, invoice_id, payload)
		SELECT $1, m.id, $3 FROM invoices o JOIN invoices m ON m.id = coalesce(o.main_id, o.id)
		WHERE o.id = $2 AND m.payer_email IS NOT NULL
		ON CONFLICT (invoice_id) WHERE kind = 'invoice.receipt' DO NOTHING`, Receipt, option, payload); err != nil {
		return fmt.Errorf("queue receipt for %s: %w", option, err)
	}
	return nil
}

func QueueSend(ctx context.Context, tx pgx.Tx, invoice, key string, by history.Actor) error {
	payload, _ := json.Marshal(Payload{Option: invoice, By: by})
	if _, err := tx.Exec(ctx, `INSERT INTO outbox_events (kind, invoice_id, payload, idempotency_key) VALUES ($1, $2, $3, $4)`,
		Sent, invoice, payload, key); err != nil {
		return fmt.Errorf("queue send for %s: %w", invoice, err)
	}
	return nil
}

// Queue adds an event for option's invoice; amount may be nil.
func Queue(ctx context.Context, tx pgx.Tx, kind, option string, amount *big.Int) error {
	p := Payload{Option: option}
	if amount != nil {
		p.Amount = amount.String()
	}
	payload, _ := json.Marshal(p)
	if _, err := tx.Exec(ctx, `INSERT INTO outbox_events (kind, invoice_id, payload)
		SELECT $1, coalesce(main_id, id), $3 FROM invoices WHERE id = $2`, kind, option, payload); err != nil {
		return fmt.Errorf("queue %s for %s: %w", kind, option, err)
	}
	return nil
}

func QueueChange(ctx context.Context, tx pgx.Tx, job, key string) error {
	payload, _ := json.Marshal(Payload{Change: key})
	if _, err := tx.Exec(ctx, "INSERT INTO outbox_events (kind, job_id, payload) VALUES ($1, $2, $3)", Change, job,
		payload); err != nil {
		return fmt.Errorf("queue change for job %s: %w", job, err)
	}
	return nil
}

func QueueInvite(ctx context.Context, tx pgx.Tx, invite, token string) error {
	payload, _ := json.Marshal(Payload{Token: token})
	if _, err := tx.Exec(ctx, "INSERT INTO outbox_events (kind, invite_id, payload) VALUES ($1, $2, $3)", Invite, invite,
		payload); err != nil {
		return fmt.Errorf("queue invite %s: %w", invite, err)
	}
	return nil
}
