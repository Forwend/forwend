// Package history keeps one append-only row per invoice change, written in the change's own transaction.
package history

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
)

// A payment status change is "invoice." and the new status, as the ledger names it.
const (
	Created              = "invoice.created"
	Canceled             = "invoice.canceled"
	PayerEmail           = "payer.email_given"
	OptionChosen         = "payer.option_chosen" // the option money came to first
	OptionPicked         = "payer.option_picked" // the option whose address the payer showed
	Held                 = "invoice.held"
	SettlementQueued     = "invoice.settlement_queued"
	ReceiverSettled      = "receiver.settled"
	CheckoutCloseChanged = "checkout.close_changed"
	Refunded             = "invoice.refunded"
	ReturnQueued         = "invoice.return_queued"
	ReturnReleased       = "invoice.return_released"
	Settled              = "invoice.settled"
	RemindersOn          = "reminders.on"
	RemindersOff         = "reminders.off"
	RemindersStopped     = "reminders.stopped"
	RepeatStopped        = "repeat.stopped"
	Edited               = "invoice.edited"   // data names the field, never its value
	Replaced             = "invoice.replaced" // canceled by a Revise
	Reopened             = "invoice.reopened"
	Numbered             = "invoice.numbered"
	// Cross-chain payments through NEAR Intents' 1Click; data has the asset an amount is in.
	CrossChainDeposit   = "crosschain.deposit_seen"
	CrossChainConverted = "crosschain.converted"
	CrossChainRefunded  = "crosschain.refunded"
	CrossChainFailed    = "crosschain.failed"
)

// Emails the worker sent to the client or payer, or gave up on.
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
	Option  string `json:"option,omitempty"`
	Amount  string `json:"amount,omitempty"` // base units; of Asset when set
	Asset   string `json:"asset,omitempty"`
	Reason  string `json:"reason,omitempty"`
	TxHash  string `json:"txHash,omitempty"`
	Step    string `json:"step,omitempty"`
	Field   string `json:"field,omitempty"`
	From    string `json:"from,omitempty"`
	To      string `json:"to,omitempty"`
	Until   string `json:"until,omitempty"`   // RFC 3339, UTC
	Invoice string `json:"invoice,omitempty"` // a Revise's other invoice
	Number  int64  `json:"number,omitempty"`
}

// Add writes option's invoice event, and its webhook event and deliveries when it has one.
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

// WebhookEvents are the API's event types in order; invoice.open means a reorg undid the detected payment.
var WebhookEvents = []string{"invoice.detected", "invoice.partially_paid", "invoice.paid", Settled, "invoice.expired",
	Canceled, Held, "invoice.open", Reopened}

func webhookType(kind string) string {
	switch {
	case kind == "invoice.expired_partially_paid":
		return "invoice.expired"
	case kind == Replaced:
		return Canceled
	case slices.Contains(WebhookEvents, kind):
		return kind
	}
	return ""
}
