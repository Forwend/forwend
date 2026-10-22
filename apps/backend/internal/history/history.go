// Package history keeps what happened to each invoice (R-123, D-92): one append-only row per change, written in the
// transaction that makes it, so the history can't miss a change or show one that rolled back.
package history

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Event kinds. A payment status change is "invoice." and the new status (Open … ExpiredPartiallyPaid).
const (
	Created              = "invoice.created"
	Canceled             = "invoice.canceled"
	PayerEmail           = "payer.email_given"   // the payer gave an address for their receipt (R-82)
	OptionChosen         = "payer.option_chosen" // the option the money came to first (D-76); data names it
	Open                 = "invoice.open"        // back to open: a reorg dropped the only transfer seen
	Detected             = "invoice.detected"
	PartiallyPaid        = "invoice.partially_paid"
	Paid                 = "invoice.paid"
	Expired              = "invoice.expired"
	ExpiredPartiallyPaid = "invoice.expired_partially_paid"
	Held                 = "invoice.held" // money held for the payer; data has its amount in base units
	SettlementQueued     = "settlement.queued"
	Settled              = "invoice.settled" // data has the settle transaction's hash
)

// Actor is who made a change.
type Actor string

const (
	Owner  Actor = "owner"
	Payer  Actor = "payer"
	System Actor = "system" // Forwend itself: the worker, the signer, a retainer month
)

// Data is an event's detail. Only these fields exist, so a row can never take a secret, a request body or an email.
type Data struct {
	Option string `json:"option,omitempty"` // the option chosen, or the one money is held on, when there are several
	Amount string `json:"amount,omitempty"` // base units of the invoice token
	TxHash string `json:"txHash,omitempty"`
}

// Add writes the event for the invoice that option belongs to.
func Add(ctx context.Context, tx pgx.Tx, option, kind string, by Actor, data Data) error {
	payload, _ := json.Marshal(data) // only strings: it can't fail
	tag, err := tx.Exec(ctx, `INSERT INTO history_events (invoice_id, kind, actor, data)
		SELECT coalesce(main_id, id), $2, $3, $4 FROM invoices WHERE id = $1`, option, kind, by, payload)
	if err == nil && tag.RowsAffected() != 1 {
		err = fmt.Errorf("no invoice %s", option)
	}
	if err != nil {
		return fmt.Errorf("history %s for %s: %w", kind, option, err)
	}
	return nil
}
