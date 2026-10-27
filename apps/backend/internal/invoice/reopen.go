package invoice

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// ReopenMargin is left before the receiver's settle deadline (R-130), so a payment at the new close still confirms and
// settles.
const ReopenMargin = 24 * time.Hour

// maxHold is the contracts' MAX_HOLD: a receiver settles until min(settle deadline, deployedAt + maxHold).
const maxHold = 30 * 24 * time.Hour

var ErrNotReopenable = errors.New("invoice can't be reopened")

var ErrLinkAtCapacity = errors.New("payment link has no slot available for this checkout")

const linkCapacitySQL = `SELECT l.max_payments IS NULL OR u.paid + u.reserved < l.max_payments
	FROM payment_links l JOIN payment_link_usage u ON u.link_id = l.id WHERE l.id = $1`

// Reopen (R-130) opens an expired, partly paid invoice's checkout again until reopenClose.
func (s *Service) Reopen(ctx context.Context, profileID, id string) (Invoice, error) {
	id = strings.ToLower(id)
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		// Options first, main row last, in the ledger's lock order, so the two can't deadlock.
		rows, err := tx.Query(ctx, `SELECT id FROM invoices
			WHERE coalesce(main_id, id) = (SELECT coalesce(main_id, id) FROM invoices WHERE id = $1) AND profile_id = $2
			ORDER BY main_id IS NULL, id FOR UPDATE`, id, profileID)
		if err != nil {
			return fmt.Errorf("lock invoice %s: %w", id, err)
		}
		locked, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return fmt.Errorf("lock invoice %s: %w", id, err)
		}
		if len(locked) == 0 {
			return ErrNotFound
		}
		var option, status, refund string
		var reopened bool
		var deadline int64
		var deployedAt *int64
		var linkID *string
		// The option the invoice shows: the chosen one, else the main row.
		if err := tx.QueryRow(ctx, `SELECT o.id, o.payment_status, o.refund_status, o.reopened_until IS NOT NULL,
			    o.settle_deadline, o.receiver_deployed_at, m.link_id::text
			FROM invoices m JOIN invoices o ON o.id = coalesce(m.chosen_id, m.id) WHERE m.id = $1`,
			locked[len(locked)-1]).Scan(&option, &status, &refund, &reopened, &deadline, &deployedAt, &linkID); err != nil {
			return fmt.Errorf("read invoice %s: %w", id, err)
		}
		var returned bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = $1 AND kind IN ('refund','settlement'))", option).Scan(&returned); err != nil {
			return err
		}
		if returned {
			return ErrNotReopenable
		}
		until := reopenClose(time.Unix(deadline, 0), deployedAt)
		// A refund under way pays the held money back to the payer: it can't go to the creator too.
		if status != ledger.ExpiredPartiallyPaid || refund != "held" || reopened || !s.now().Before(until) {
			return ErrNotReopenable
		}
		if linkID != nil {
			if _, err := tx.Exec(ctx, "SELECT 1 FROM payment_links WHERE id = $1 FOR UPDATE", *linkID); err != nil {
				return fmt.Errorf("lock payment link: %w", err)
			}
			var capacity bool
			if err := tx.QueryRow(ctx, linkCapacitySQL, *linkID).Scan(&capacity); err != nil {
				return fmt.Errorf("read payment link capacity: %w", err)
			}
			if !capacity {
				return ErrLinkAtCapacity
			}
		}
		return ledger.Reopen(ctx, tx, option, until.Unix())
	})
	if err != nil {
		return Invoice{}, err
	}
	return s.GetOfProfile(ctx, profileID, id)
}

// reopenClose is ReopenMargin before the receiver's settle deadline, which an early deploy brings forward. Zero when
// the deploy time was never read: the option closed before the ledger read it.
func reopenClose(settleDeadline time.Time, deployedAt *int64) time.Time {
	if deployedAt == nil {
		return time.Time{}
	}
	deadline := settleDeadline
	if held := time.Unix(*deployedAt, 0).Add(maxHold); *deployedAt > 0 && held.Before(deadline) {
		deadline = held
	}
	return deadline.Add(-ReopenMargin)
}
