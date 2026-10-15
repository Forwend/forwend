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
	Held    = "invoice.held" // money held for the payer: an excess, an expired partial payment, a late deposit, one after cancel or on another option
)

// Payload names the option row the event happened on (its token and network) and, for held money, the amount.
type Payload struct {
	Option string `json:"option"`
	Amount string `json:"amount,omitempty"`
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
