// Package outbox queues the events the worker sends as email (R-80): one row per event, written in the transaction
// that makes the change, so an event is never lost or sent for a change that rolled back.
package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"

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
)

// Payload names the option row the event happened on (its token and network), for held money the amount, and for a
// reminder its step.
type Payload struct {
	Option string `json:"option"`
	Amount string `json:"amount,omitempty"`
	Step   string `json:"step,omitempty"`
}

// QueueReceipt adds the payer's receipt for the invoice that option belongs to, when the payer gave an address and no
// receipt is queued yet (R-82).
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
