// Package notify sends the owner's email for each outbox event (R-80): paid, settled and money held for the payer.
// One worker claims each event once (FOR UPDATE SKIP LOCKED); the event id is Resend's Idempotency-Key, so a retry
// after a lost answer sends nothing twice. Nothing logs an address, a subject or a body.
package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/document"
	"github.com/ensp1re/forwend/apps/backend/internal/email"
	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxAttempts: after this many failed sends the event is given up. With Backoff that ends within a few hours, inside
// Resend's 24-hour idempotency window.
const MaxAttempts = 10

// Batch bounds the events one call sends, so a backlog never holds up the worker's chain rounds.
const Batch = 20

// Backoff is the wait after the n-th failed send: 1 min doubling, at most 1 h.
func Backoff(n int) time.Duration {
	return min(time.Minute<<min(n-1, 6), time.Hour)
}

// Deliver sends up to Batch due events. webURL is the web app's origin, for the invoice link.
func Deliver(ctx context.Context, pool *pgxpool.Pool, sender email.Sender, webURL string) error {
	for range Batch {
		more, err := deliverOne(ctx, pool, sender, webURL)
		if err != nil || !more {
			return err
		}
	}
	return nil
}

// deliverOne sends the oldest due event; false when none is due.
func deliverOne(ctx context.Context, pool *pgxpool.Pool, sender email.Sender, webURL string) (bool, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("deliver email: %w", err)
	}
	defer tx.Rollback(ctx)
	var (
		id       int64
		kind     string
		invoice  string
		payload  []byte
		attempts int
	)
	err = tx.QueryRow(ctx, `SELECT id, kind, invoice_id, payload, attempts FROM outbox_events
		WHERE published_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
		ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&id, &kind, &invoice, &payload, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	} else if err != nil {
		return false, fmt.Errorf("claim email event: %w", err)
	}
	var p outbox.Payload
	if err := json.Unmarshal(payload, &p); err != nil {
		return false, fmt.Errorf("read email event %d: %w", id, err)
	}
	var (
		on                          bool
		to, payer                   *string
		number                      int64
		symbol, amount, payee, hash string
		decimals                    int
		chainID                     uint64
	)
	if err := tx.QueryRow(ctx, `SELECT p.email_notifications, u.login_email, m.payer_email, m.number,
		    coalesce(m.issuer_name, m.sender_name, ''), t.symbol, t.decimals, o.chain_id, o.amount::text,
		    coalesce((SELECT d.tx_hash FROM chain_transfers d WHERE d.invoice_id = o.id AND d.status = 'confirmed'
		              AND d.block_time <= o.expires_at ORDER BY d.block_number DESC, d.log_index DESC LIMIT 1), '')
		FROM invoices m JOIN profiles p ON p.id = m.profile_id JOIN users u ON u.id = p.user_id
		JOIN invoices o ON o.id = $2 JOIN tokens t ON t.chain_id = o.chain_id AND t.contract = o.token_contract
		WHERE m.id = $1`, invoice, p.Option).Scan(&on, &to, &payer, &number, &payee, &symbol, &decimals, &chainID,
		&amount, &hash); err != nil {
		return false, fmt.Errorf("read email event %d invoice: %w", id, err)
	}
	// The payer's receipt goes to the address they gave, whatever the owner's setting (R-82).
	if kind == outbox.Receipt {
		on, to = true, payer
	}
	if !on || to == nil || *to == "" {
		// Email off for this profile, or no login email ('' when the account has none; NULL when it was never read):
		// nothing to send, and nothing waits for it.
		if _, err := tx.Exec(ctx, "UPDATE outbox_events SET published_at = now() WHERE id = $1", id); err != nil {
			return false, fmt.Errorf("skip email event %d: %w", id, err)
		}
		return true, tx.Commit(ctx)
	}
	if p.Amount != "" {
		amount = p.Amount
	}
	units, _ := new(big.Int).SetString(amount, 10)
	var m email.Message
	if kind == outbox.Receipt {
		m = receipt(document.Number(number), document.Amount(units, decimals, symbol), document.NetworkName(chainID), payee,
			document.TxURL(chainID, hash), webURL+"/api/v1/invoices/"+invoice+"/receipt.pdf")
	} else {
		m = compose(kind, document.Number(number), document.Amount(units, decimals, symbol), document.NetworkName(chainID),
			webURL+"/app/invoices/"+invoice, webURL+"/app/notifications")
	}
	// The invoice id too: event ids start again in another database (a reset, staging) that may share the Resend team.
	m.To, m.Key = *to, fmt.Sprintf("forwend-%s-%d", invoice, id)
	if err := sender.Send(ctx, m); err != nil {
		attempts++
		if attempts >= MaxAttempts {
			slog.Error("email given up", "event", id, "kind", kind, "attempts", attempts, "err", err)
			_, err = tx.Exec(ctx, "UPDATE outbox_events SET attempts = $2, failed_at = now() WHERE id = $1", id, attempts)
		} else {
			slog.Warn("email failed; trying again later", "event", id, "kind", kind, "attempt", attempts, "err", err)
			_, err = tx.Exec(ctx, "UPDATE outbox_events SET attempts = $2, next_attempt_at = now() + $3 WHERE id = $1",
				id, attempts, Backoff(attempts))
		}
		if err != nil {
			return false, fmt.Errorf("record email event %d failure: %w", id, err)
		}
		// Stop this round: a Resend that fails or hangs must not hold up the worker's chain rounds for a whole batch.
		return false, tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, "UPDATE outbox_events SET attempts = attempts + 1, published_at = now() WHERE id = $1", id); err != nil {
		return false, fmt.Errorf("record email event %d: %w", id, err)
	}
	return true, tx.Commit(ctx)
}

// compose says what happened in plain words, with the invoice link and where to turn email off.
func compose(kind, number, amount, network, link, settings string) email.Message {
	var subject, what string
	switch kind {
	case outbox.Paid:
		subject = number + " paid: " + amount
		what = number + " was paid: " + amount + " on " + network + ". Forwend sends it to your wallet next."
	case outbox.Settled:
		subject = number + ": " + amount + " is in your wallet"
		what = "The payment for " + number + " reached your wallet: " + amount + " on " + network + "."
	default: // outbox.Held
		subject = number + ": " + amount + " held for the payer"
		what = amount + " for " + number + " on " + network + " does not pay it: more than the amount, a partial " +
			"payment when the checkout closed, money after it closed or after you canceled it, or money on another " +
			"payment option. It is held for the payer, not paid to you."
	}
	return email.Message{Subject: subject, Text: what + "\n\nOpen the invoice: " + link +
		"\n\nYou get this email because email is on for this profile. Turn it off: " + settings + "\n"}
}

// receipt is the payer's one email (R-82): what they paid, to whom, the transaction and the receipt PDF. Nothing else
// is ever sent to this address.
func receipt(number, amount, network, payee, tx, pdf string) email.Message {
	to := ""
	if payee != "" {
		to = " to " + payee
	}
	text := "You paid " + amount + " on " + network + to + " for " + number + "."
	if tx != "" {
		text += "\n\nTransaction: " + tx
	}
	text += "\nReceipt (PDF): " + pdf + "\n\nYou get this one email because you asked for the receipt on the payment " +
		"page. Forwend sends nothing else to this address.\n"
	return email.Message{Subject: "Your receipt for " + number, Text: text}
}
