package ledger

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

// Reopen (R-130): each deposit's given-back part names its transfer, so readers see which deposits paid the
// creator. The caller holds the invoice's rows, as Process does.
func Reopen(ctx context.Context, tx pgx.Tx, option string, until int64) error {
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
