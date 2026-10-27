package ledger

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

// Reopen (R-130): each deposit's given-back part names its transfer, so readers see which deposits paid the
// creator. The caller holds the invoice's rows, as Process does.
func Reopen(ctx context.Context, tx pgx.Tx, option string, until int64) error {
	position, err := ReadReopenPosition(ctx, tx, option)
	if err != nil {
		return err
	}
	if position == nil || until <= position.Time {
		return ErrReconciliationPending
	}
	if err := ensureNoReturnedFunds(ctx, tx, option); err != nil {
		return err
	}
	var amountText string
	if err := tx.QueryRow(ctx, "SELECT amount::text FROM invoices WHERE id = $1", option).Scan(&amountText); err != nil {
		return fmt.Errorf("read invoice %s amount: %w", option, err)
	}
	left, _ := new(big.Int).SetString(amountText, 10)
	rows, err := tx.Query(ctx, `SELECT x.chain_transfer_id, (-e.amount)::text
		FROM ledger_transactions x JOIN ledger_entries e ON e.transaction_id = x.id AND e.account = 'payer_held'
		LEFT JOIN chain_transfers t ON t.id = x.chain_transfer_id
		WHERE x.invoice_id = $1 AND x.kind IN ('expiry', 'deposit')
		ORDER BY t.block_number NULLS FIRST, t.log_index`, option)
	if err != nil {
		return fmt.Errorf("read invoice %s held: %w", option, err)
	}
	type held struct {
		Transfer *int64
		Amount   string
	}
	parts, err := pgx.CollectRows(rows, pgx.RowToStructByPos[held])
	if err != nil {
		return fmt.Errorf("read invoice %s held: %w", option, err)
	}
	for _, p := range parts {
		move, _ := new(big.Int).SetString(p.Amount, 10)
		if move.Cmp(left) > 0 {
			move.Set(left)
		}
		if move.Sign() <= 0 {
			break
		}
		if err := book(ctx, tx, option, "reopen", p.Transfer, new(big.Int), move, new(big.Int).Neg(move)); err != nil {
			return err
		}
		left.Sub(left, move)
	}
	stillHeld, err := accountBalance(ctx, tx, option, "payer_held")
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE invoices SET payment_status = 'partially_paid', reopened_until = $2,
		refund_status = CASE WHEN $3 THEN 'held' ELSE 'none' END WHERE id = $1`,
		option, until, stillHeld.Sign() != 0); err != nil {
		return fmt.Errorf("reopen invoice %s: %w", option, err)
	}
	return history.Add(ctx, tx, option, history.Reopened, history.Owner,
		history.Data{Until: time.Unix(until, 0).UTC().Format(time.RFC3339)})
}

var ErrReconciliationPending = errors.New("payment evidence is still being reconciled")

type ReopenPosition struct {
	Block uint64
	Hash  string
	Time  int64
}

func ReadReopenPosition(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, invoiceID string) (*ReopenPosition, error) {
	var p ReopenPosition
	err := db.QueryRow(ctx, `SELECT s.scanned_block, s.scanned_hash, s.block_time FROM receiver_scans s WHERE s.invoice_id = $1
  AND s.opening_checked AND s.history_complete
  AND s.scanned_block >= coalesce((SELECT c.last_finalized_block FROM chain_cursors c JOIN invoices i ON i.chain_id = c.chain_id WHERE i.id = $1),0)
  AND NOT EXISTS (SELECT 1 FROM chain_transfers d WHERE d.invoice_id = $1 AND d.status = 'confirmed'
    AND (NOT d.booked OR NOT EXISTS (SELECT 1 FROM receiver_deposit_proofs p WHERE p.chain_transfer_id = d.id)))
  AND s.reconciliation_error IS NULL AND s.booking_error IS NULL AND s.scanned_block IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM chain_transfers d WHERE d.invoice_id = $1 AND d.booked AND d.block_number > s.scanned_block)
  AND NOT EXISTS (SELECT 1 FROM receiver_outflows o WHERE o.invoice_id = $1 AND o.kind IN ('refund','settlement'))
  AND s.balance = (SELECT coalesce(sum(e.amount),0) FROM ledger_entries e
                  JOIN ledger_transactions t ON t.id = e.transaction_id WHERE t.invoice_id = $1 AND e.account = 'receiver')`, invoiceID).Scan(&p.Block, &p.Hash, &p.Time)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}
