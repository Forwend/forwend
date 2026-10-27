package ledger

import (
	"context"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
)

type ReceiverState struct {
	InvoiceID                                                                            string
	PaymentStatus, SettlementStatus, RefundStatus                                        string
	HistoryComplete                                                                      bool
	VerifiedBlock                                                                        *uint64
	VerifiedHash                                                                         string
	VerifiedTime                                                                         *time.Time
	ObservedBalance                                                                      *big.Int
	BalanceDifference                                                                    *big.Int
	ReconciliationError, BookingError                                                    string
	RetryAt                                                                              *time.Time
	UpdatedAt                                                                            time.Time
	ChainFinalizedBlock                                                                  *uint64
	TotalDeposits, PendingDeposits, UnbookedDeposits, UnprovedDeposits, UnbookedOutflows int64
}

func ReadReceiverStates(ctx context.Context, db interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, ids []string, amounts map[string]*Amounts) (map[string]*ReceiverState, error) {
	rows, err := db.Query(ctx, `SELECT i.id,i.payment_status,i.settlement_status,i.refund_status,s.history_complete,
   s.scanned_block,coalesce(s.scanned_hash,''),s.block_time,s.balance::text,coalesce(s.reconciliation_error,''),
   coalesce(s.booking_error,''),s.retry_at,s.updated_at,c.last_finalized_block,
   (SELECT count(*) FROM chain_transfers d WHERE d.invoice_id = i.id AND d.status <> 'reorged'),
   (SELECT count(*) FROM chain_transfers d WHERE d.invoice_id = i.id AND d.status = 'detected'),
   (SELECT count(*) FROM chain_transfers d WHERE d.invoice_id = i.id AND d.status = 'confirmed' AND NOT d.booked),
   (SELECT count(*) FROM chain_transfers d WHERE d.invoice_id = i.id AND d.status = 'confirmed'
     AND NOT EXISTS (SELECT 1 FROM receiver_deposit_proofs p WHERE p.chain_transfer_id = d.id)),
   (SELECT count(*) FROM receiver_outflows o WHERE o.invoice_id = i.id AND o.kind <> 'recovery' AND o.ledger_transaction_id IS NULL),
   `+ComparableReceiverSQL("i.id", "s.scanned_block")+`
   FROM invoices i JOIN receiver_scans s ON s.invoice_id = i.id LEFT JOIN chain_cursors c ON c.chain_id = i.chain_id
   WHERE i.id = ANY($1::text[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]*ReceiverState, len(ids))
	for rows.Next() {
		state := &ReceiverState{}
		var at *int64
		var balance *string
		var comparable bool
		if err := rows.Scan(&state.InvoiceID, &state.PaymentStatus, &state.SettlementStatus, &state.RefundStatus, &state.HistoryComplete,
			&state.VerifiedBlock, &state.VerifiedHash, &at, &balance, &state.ReconciliationError, &state.BookingError, &state.RetryAt, &state.UpdatedAt,
			&state.ChainFinalizedBlock, &state.TotalDeposits, &state.PendingDeposits, &state.UnbookedDeposits, &state.UnprovedDeposits, &state.UnbookedOutflows, &comparable); err != nil {
			return nil, err
		}
		if at != nil {
			value := time.Unix(*at, 0).UTC()
			state.VerifiedTime = &value
		}
		if balance != nil {
			state.ObservedBalance, _ = new(big.Int).SetString(*balance, 10)
			if a := amounts[state.InvoiceID]; comparable && a != nil {
				state.BalanceDifference = new(big.Int).Sub(state.ObservedBalance, a.Receiver)
			}
		}
		result[state.InvoiceID] = state
	}
	return result, rows.Err()
}

// Arguments are trusted SQL expressions, never request text.
func ComparableReceiverSQL(invoiceID, block string) string {
	return `NOT (` + unpositionedCashSQL(invoiceID) + `)
 AND NOT EXISTS (SELECT 1 FROM chain_transfers comparable_deposit WHERE comparable_deposit.invoice_id = ` + invoiceID + ` AND comparable_deposit.booked AND comparable_deposit.block_number > ` + block + `)
 AND NOT EXISTS (SELECT 1 FROM receiver_outflows comparable_outflow WHERE comparable_outflow.invoice_id = ` + invoiceID + ` AND comparable_outflow.ledger_transaction_id IS NOT NULL AND comparable_outflow.block_number > ` + block + `)`
}

func unpositionedCashSQL(invoiceID string) string {
	return `EXISTS (SELECT 1 FROM ledger_transactions comparable_journal JOIN ledger_entries comparable_entry ON comparable_entry.transaction_id = comparable_journal.id
 WHERE comparable_journal.invoice_id = ` + invoiceID + ` AND comparable_entry.account = 'receiver' AND (
  comparable_journal.kind = 'deposit' AND NOT EXISTS (SELECT 1 FROM receiver_deposit_proofs comparable_proof WHERE comparable_proof.chain_transfer_id = comparable_journal.chain_transfer_id)
  OR comparable_journal.kind IN ('refund','settlement') AND NOT EXISTS (SELECT 1 FROM receiver_outflows comparable_source WHERE comparable_source.ledger_transaction_id = comparable_journal.id)
  OR comparable_journal.kind NOT IN ('deposit','refund','settlement')))`
}
