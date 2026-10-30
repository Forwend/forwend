// Package history keeps what happened to each invoice (R-123, D-92): one append-only row per change, written in the
// transaction that makes it, so the history can't miss a change or show one that rolled back.
package history

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// A payment status change is "invoice." and the new status, as the ledger names it.
const (
	Created              = "invoice.created"
	Canceled             = "invoice.canceled"
	PayerEmail           = "payer.email_given"   // the payer gave an address for their receipt (R-82)
	OptionChosen         = "payer.option_chosen" // the option the money came to first (D-76); data names it
	OptionPicked         = "payer.option_picked" // the option the payer showed the address for (R-57); data names it
	Held                 = "invoice.held"        // money held for the payer; data has its amount in base units and reason
	SettlementQueued     = "invoice.settlement_queued"
	ReceiverSettled      = "receiver.settled"
	CheckoutCloseChanged = "checkout.close_changed"
	Refunded             = "invoice.refunded"
	Settled              = "invoice.settled" // data has the settle transaction's hash
	RemindersOn          = "reminders.on"
	RemindersOff         = "reminders.off"
	RemindersStopped     = "reminders.stopped" // by the client's stop link (R-96)
	RepeatStopped        = "repeat.stopped"
	Edited               = "invoice.edited"   // data names the field, never its value (R-127)
	Replaced             = "invoice.replaced" // canceled by a Revise; data names the new invoice (R-129)
	Reopened             = "invoice.reopened" // data has the new close in until (R-130)
	Numbered             = "invoice.numbered" // a link invoice took its number with its first deposit (R-141)
)

// Emails the worker sent to the client or payer, or gave up on (R-126); a reminder's data has its step.
const (
	InvoiceEmailed      = "email.invoice_sent"
	InvoiceEmailFailed  = "email.invoice_failed"
	ReminderEmailed     = "email.reminder_sent"
	ReminderEmailFailed = "email.reminder_failed"
	ReceiptEmailed      = "email.receipt_sent"
	ReceiptEmailFailed  = "email.receipt_failed"
)

type Actor string

const (
	Owner  Actor = "owner"
	Payer  Actor = "payer"
	System Actor = "system" // Forwend itself: the worker, the signer, a retainer month
)

// Data has only these fields, so a row can never take a secret, a request body or an email.
type Data struct {
	Option string `json:"option,omitempty"` // the option chosen, or the one money is held on, when there are several
	Amount string `json:"amount,omitempty"` // base units of the invoice token
	Reason string `json:"reason,omitempty"` // why held money is the payer's: one of the ledger's Held reasons
	TxHash string `json:"txHash,omitempty"`
	Step   string `json:"step,omitempty"` // a reminder's step (R-96)
	Field  string `json:"field,omitempty"`
	From   string `json:"from,omitempty"` // an edited due date's old and new value (R-128)
	To     string `json:"to,omitempty"`
	Until  string `json:"until,omitempty"` // a reopen's new close (R-130), RFC 3339 in UTC
	// The other invoice of a Revise (R-129): on the old one the new, on the new one's created row the old.
	Invoice string `json:"invoice,omitempty"`
	Number  int64  `json:"number,omitempty"`
}

// Add writes the event for the invoice that option belongs to, and its webhook event when it has one (R-147).
func Add(ctx context.Context, tx pgx.Tx, option, kind string, by Actor, data Data) error {
	payload, _ := json.Marshal(data) // only strings: it can't fail
	var id int64
	var invoice string
	err := tx.QueryRow(ctx, `INSERT INTO history_events (invoice_id, kind, actor, data)
		SELECT coalesce(main_id, id), $2, $3, $4 FROM invoices WHERE id = $1 RETURNING id, invoice_id`,
		option, kind, by, payload).Scan(&id, &invoice)
	if errors.Is(err, pgx.ErrNoRows) {
		err = fmt.Errorf("no invoice %s", option)
	}
	if t := webhookType(kind); err == nil && t != "" {
		_, err = tx.Exec(ctx, `WITH e AS (
			    INSERT INTO webhook_events (history_id, profile_id, invoice_id, type, livemode, sequence)
			    SELECT $1, m.profile_id, m.id, $3, c.livemode,
			           coalesce((SELECT max(sequence) FROM webhook_events WHERE invoice_id = m.id), 0) + 1
			    FROM invoices m JOIN chains c ON c.chain_id = m.chain_id WHERE m.id = $2
			    RETURNING id, profile_id, livemode)
			INSERT INTO webhook_deliveries (endpoint_id, event_id)
			SELECT w.id, e.id FROM e JOIN webhook_endpoints w ON w.profile_id = e.profile_id AND w.livemode = e.livemode
			JOIN invoices m ON m.id = $2
			WHERE w.enabled AND $3 = ANY (w.events) AND (w.store_id IS NULL OR w.store_id = m.store_id)`, id, invoice, t)
	}
	if err != nil {
		return fmt.Errorf("history %s for %s: %w", kind, option, err)
	}
	return nil
}

// webhookType is the webhook event a change of kind sends (R-147), or "" for none. A payment status is the ledger's
// name for it; a Revise cancels the invoice it replaces.
func webhookType(kind string) string {
	switch kind {
	case "invoice.detected", "invoice.partially_paid", "invoice.paid", "invoice.expired", "invoice.open", Canceled, Held,
		Settled, Reopened:
		return kind
	case "invoice.expired_partially_paid":
		return "invoice.expired"
	case Replaced:
		return Canceled
	}
	return ""
}
