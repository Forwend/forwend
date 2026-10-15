package invoice

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

// ErrReceiptSent: the receipt already went to the address given, so it can't change any more.
var ErrReceiptSent = errors.New("receipt already sent")

// A plain shape check: something@domain.tld with no spaces. Delivery is the real test.
var emailShape = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// SetPayerEmail keeps, and returns as kept, the address the payer gave on the pay page for this invoice's receipt only (R-82, D-68). It can
// change until the receipt is sent. An invoice already paid queues its receipt now; otherwise the ledger queues it when
// paid. It locks the invoice's main row, as the ledger does, so the two never decide at once.
func (s *Service) SetPayerEmail(ctx context.Context, id, email string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if len(email) > 254 || !emailShape.MatchString(email) {
		return "", fmt.Errorf("%w: email: enter an address like name@example.com", ErrInvalid)
	}
	id = strings.ToLower(id)
	return email, pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var main, option, status string
		err := tx.QueryRow(ctx, `SELECT m.id FROM invoices m WHERE m.id = (SELECT coalesce(main_id, id) FROM invoices WHERE id = $1)
			FOR UPDATE`, id).Scan(&main)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("lock invoice %s: %w", id, err)
		}
		// The receipt row too: the worker holds it while it sends, so a change waits for that send and then sees it sent,
		// instead of answering "on its way" to an address the email did not go to.
		var sent bool
		err = tx.QueryRow(ctx, `SELECT published_at IS NOT NULL FROM outbox_events WHERE invoice_id = $1 AND kind = $2
			FOR UPDATE`, main, outbox.Receipt).Scan(&sent)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read invoice %s receipt: %w", id, err)
		}
		if sent {
			return ErrReceiptSent
		}
		if _, err := tx.Exec(ctx, "UPDATE invoices SET payer_email = $2 WHERE id = $1", main, email); err != nil {
			return fmt.Errorf("save payer email: %w", err)
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
		if status == ledger.Paid {
			return outbox.QueueReceipt(ctx, tx, option)
		}
		return nil
	})
}
