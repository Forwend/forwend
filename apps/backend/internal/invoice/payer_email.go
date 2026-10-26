package invoice

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

var ErrReceiptSent = errors.New("receipt already sent")

// SetPayerEmail locks the main row as the ledger does, so the two never decide at once (R-82, D-68). allow runs only
// when the receipt goes out now, so an unknown link or a bad address spends none of the shared limit (R-117).
func (s *Service) SetPayerEmail(ctx context.Context, payToken, email string, allow func() time.Duration) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	// As a client email is checked: plain text, and exactly one address with nothing around it.
	if a, err := mail.ParseAddress(email); err != nil || a.Address != email || len(email) > profile.MaxClientEmail ||
		!utf8.ValidString(email) || !profile.PlainText(email, false) {
		return "", fmt.Errorf("%w: email: enter an address like name@example.com", ErrInvalid)
	}
	id, ok := idOf(payToken)
	if !ok {
		return "", ErrNotFound
	}
	return email, pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var main, option, status string
		err := tx.QueryRow(ctx, "SELECT id FROM invoices WHERE id = $1 FOR UPDATE", id).Scan(&main)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("lock invoice %s: %w", id, err)
		}
		// Lock the receipt row too: the worker holds it while sending, so a change waits and then sees it sent.
		var sent bool
		err = tx.QueryRow(ctx, `SELECT published_at IS NOT NULL FROM outbox_events WHERE invoice_id = $1 AND kind = $2
			FOR UPDATE`, main, outbox.Receipt).Scan(&sent)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read invoice %s receipt: %w", id, err)
		}
		if sent {
			return ErrReceiptSent
		}
		tag, err := tx.Exec(ctx, "UPDATE invoices SET payer_email = $2 WHERE id = $1 AND payer_email IS DISTINCT FROM $2",
			main, email)
		if err != nil {
			return fmt.Errorf("save payer email: %w", err)
		}
		if tag.RowsAffected() == 1 {
			if err := history.Add(ctx, tx, main, history.PayerEmail, history.Payer, history.Data{}); err != nil {
				return err
			}
		}
		// A receipt the worker gave up on, or still retrying, starts again for the new address.
		if _, err := tx.Exec(ctx, `UPDATE outbox_events SET attempts = 0, failed_at = NULL, next_attempt_at = now()
			WHERE invoice_id = $1 AND kind = $2 AND published_at IS NULL`, main, outbox.Receipt); err != nil {
			return fmt.Errorf("restart invoice %s receipt: %w", id, err)
		}
		if err := tx.QueryRow(ctx, "SELECT option_id, payment_status FROM "+invoicesCurrent+" WHERE id = $1", main).
			Scan(&option, &status); err != nil {
			return fmt.Errorf("read invoice %s status: %w", id, err)
		}
		if status != ledger.Paid {
			return nil
		}
		if wait := allow(); wait > 0 {
			return &TooSoonError{Wait: wait}
		}
		return outbox.QueueReceipt(ctx, tx, option)
	})
}
