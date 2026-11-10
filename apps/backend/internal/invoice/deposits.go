package invoice

import (
	"context"
	"fmt"
	"math/big"
	"slices"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/finality"
	"github.com/jackc/pgx/v5"
)

const DepositPreviewLimit = 100

type DepositSummary struct {
	Count                                   int64
	OnTimeAmount, LateAmount, PendingAmount *big.Int
}

func readDepositSummaries(ctx context.Context, db paymentReader, ids []string) (map[string]*DepositSummary, error) {
	rows, err := db.Query(ctx, `SELECT i.id,count(t.id),
 coalesce(sum(t.amount) FILTER (WHERE t.block_time<=i.closes_at),0)::text,
 coalesce(sum(t.amount) FILTER (WHERE t.block_time>i.closes_at),0)::text,
 coalesce(sum(t.amount) FILTER (WHERE t.block_time<=i.closes_at AND NOT EXISTS (
   SELECT 1 FROM ledger_transactions x WHERE x.chain_transfer_id=t.id AND x.kind IN ('deposit','reopen','chosen'))),0)::text
 FROM invoices i JOIN chain_transfers t ON t.invoice_id=i.id AND t.status<>'reorged'
 WHERE i.id=ANY($1::text[]) GROUP BY i.id`, ids)
	if err != nil {
		return nil, fmt.Errorf("read deposit summaries: %w", err)
	}
	defer rows.Close()
	summaries := make(map[string]*DepositSummary, len(ids))
	for rows.Next() {
		var id, onTime, late, pending string
		summary := &DepositSummary{}
		if err := rows.Scan(&id, &summary.Count, &onTime, &late, &pending); err != nil {
			return nil, fmt.Errorf("read deposit summaries: %w", err)
		}
		summary.OnTimeAmount, _ = new(big.Int).SetString(onTime, 10)
		summary.LateAmount, _ = new(big.Int).SetString(late, 10)
		summary.PendingAmount, _ = new(big.Int).SetString(pending, 10)
		summaries[id] = summary
	}
	return summaries, rows.Err()
}

// DepositPaidSQL is the part of chain transfer t the ledger booked to the creator, as text; NULL until booked.
const DepositPaidSQL = `(SELECT coalesce(-sum(e.amount) FILTER (WHERE e.account = 'recipient_payable'), 0)::text
 FROM ledger_transactions x JOIN ledger_entries e ON e.transaction_id = x.id
 WHERE x.chain_transfer_id = t.id AND x.kind IN ('deposit', 'reopen', 'chosen') HAVING count(*) > 0)`

const depositColumns = `tx_hash,log_index,from_address,amount::text,block_number,block_time,status,
 coalesce(detected_finalized_block,0),` + DepositPaidSQL + `,
 t.block_time > (SELECT closes_at FROM invoices WHERE id=t.invoice_id)`

func readDepositPreview(ctx context.Context, db paymentReader, id string, head finality.Block, count int64) ([]Deposit, error) {
	if count <= DepositPreviewLimit {
		return readDeposits(ctx, db, id, head, DepositPreviewLimit)
	}
	// Older representatives keep receipts and confirmation progress correct when history is truncated. Before an option
	// is chosen the pay page reads the choice from these 100 (R-119), so past them it may wait for the API's choice.
	rows, err := db.Query(ctx, `WITH selected AS (
 (SELECT id FROM chain_transfers WHERE invoice_id=$1 AND status<>'reorged'
  ORDER BY block_number DESC,log_index DESC LIMIT $2)
 UNION
 (SELECT t.id FROM chain_transfers t JOIN invoices i ON i.id=t.invoice_id
  WHERE t.invoice_id=$1 AND t.status<>'reorged' AND t.block_time<=i.closes_at
  ORDER BY t.block_time,t.block_number,t.log_index LIMIT 1)
 UNION
 (SELECT t.id FROM chain_transfers t WHERE t.invoice_id=$1 AND t.status<>'reorged' AND (`+DepositPaidSQL+`)::numeric>0
  ORDER BY t.block_number DESC,t.log_index DESC LIMIT 1)
 UNION
 (SELECT t.id FROM chain_transfers t JOIN invoices i ON i.id=t.invoice_id
  WHERE t.invoice_id=$1 AND t.status NOT IN ('confirmed','reorged') AND t.block_time<=i.closes_at
  ORDER BY t.block_number DESC,t.log_index DESC LIMIT 1)
 UNION
 (SELECT t.id FROM chain_transfers t JOIN invoices i ON i.id=t.invoice_id
  WHERE t.invoice_id=$1 AND t.status NOT IN ('confirmed','reorged') AND t.block_time<=i.closes_at
  ORDER BY t.block_time DESC,t.block_number DESC,t.log_index DESC LIMIT 1)
 UNION
 (SELECT t.id FROM chain_transfers t WHERE t.invoice_id=$1 AND t.status='confirmed' AND NOT EXISTS (
    SELECT 1 FROM ledger_transactions x WHERE x.chain_transfer_id=t.id AND x.kind IN ('deposit','reopen','chosen'))
  ORDER BY t.block_time,t.block_number,t.log_index LIMIT 1)
 ) SELECT `+depositColumns+` FROM chain_transfers t WHERE t.id IN (SELECT id FROM selected)
 ORDER BY block_number,log_index`, id, DepositPreviewLimit-5)
	if err != nil {
		return nil, fmt.Errorf("read invoice %s deposit preview: %w", id, err)
	}
	return collectDeposits(rows, id, head)
}

func readDeposits(ctx context.Context, db paymentReader, id string, head finality.Block, limit int) ([]Deposit, error) {
	rows, err := db.Query(ctx, `SELECT `+depositColumns+` FROM chain_transfers t WHERE invoice_id = $1 AND status <> 'reorged'
 ORDER BY block_number DESC,log_index DESC LIMIT $2`, id, limit)
	if err != nil {
		return nil, fmt.Errorf("read invoice %s deposits: %w", id, err)
	}
	out, err := collectDeposits(rows, id, head)
	slices.Reverse(out)
	return out, err
}

func collectDeposits(rows pgx.Rows, id string, head finality.Block) ([]Deposit, error) {
	defer rows.Close()
	out := []Deposit{}
	for rows.Next() {
		var d Deposit
		var amount string
		var paid *string
		var blockTime, seenFinalized uint64
		if err := rows.Scan(&d.TxHash, &d.LogIndex, &d.From, &amount, &d.BlockNumber, &blockTime, &d.Status,
			&seenFinalized, &paid, &d.Late); err != nil {
			return nil, fmt.Errorf("read invoice %s deposits: %w", id, err)
		}
		d.Amount, _ = new(big.Int).SetString(amount, 10)
		if paid != nil {
			d.Paid, _ = new(big.Int).SetString(*paid, 10)
		}
		d.BlockTime = time.Unix(int64(blockTime), 0).UTC()
		if d.Status != "confirmed" {
			d.Progress = finality.ProgressOf(finality.Block{Number: d.BlockNumber, Time: blockTime}, head)
			d.BlocksTotal = d.BlocksLeft
			if seenFinalized > 0 && seenFinalized < d.BlockNumber {
				d.BlocksTotal = max(d.BlocksLeft, d.BlockNumber-seenFinalized)
			}
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
