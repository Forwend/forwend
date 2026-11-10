package ledger

import (
	"context"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
)

// ReceiverState is what the chain's scan has verified for a receive address. The scan reads every watched address
// together, so its coverage is the chain's finalized cursor; a balance the ledger can't explain has a balance alert.
// HistoryComplete holds while the scan still reads the address's deposits: until 30 days after its settle deadline
// (watcher.watchedAfterDeadline), or while a deposit to it is detected. UnprovedDeposits is 1 while the chain holds money no recorded deposit explains.
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
}, ids []string) (map[string]*ReceiverState, error) {
	rows, err := db.Query(ctx, `SELECT i.id,i.payment_status,i.settlement_status,i.refund_status,
   c.last_finalized_block,c.last_finalized_time,coalesce(c.updated_at,i.created_at),a.invoice_id IS NOT NULL,a.next_check_at,
   (SELECT count(*) FROM chain_transfers d WHERE d.invoice_id = i.id AND d.status <> 'reorged'),
   (SELECT count(*) FROM chain_transfers d WHERE d.invoice_id = i.id AND d.status = 'detected'),
   (SELECT count(*) FROM chain_transfers d WHERE d.invoice_id = i.id AND d.status = 'confirmed' AND NOT d.booked),
   (SELECT count(*) FROM receiver_outflows o WHERE o.invoice_id = i.id AND o.kind <> 'recovery' AND o.ledger_transaction_id IS NULL),
   (a.excess IS TRUE)::int,
   i.settle_deadline > extract(epoch FROM now())::bigint - 2592000
   FROM invoices i LEFT JOIN chain_cursors c ON c.chain_id = i.chain_id
   LEFT JOIN invoice_balance_alerts a ON a.invoice_id = i.id
   WHERE i.id = ANY($1::text[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]*ReceiverState, len(ids))
	for rows.Next() {
		state := &ReceiverState{}
		var at *int64
		var unexplained bool
		if err := rows.Scan(&state.InvoiceID, &state.PaymentStatus, &state.SettlementStatus, &state.RefundStatus,
			&state.VerifiedBlock, &at, &state.UpdatedAt, &unexplained, &state.RetryAt, &state.TotalDeposits,
			&state.PendingDeposits, &state.UnbookedDeposits, &state.UnbookedOutflows, &state.UnprovedDeposits,
			&state.HistoryComplete); err != nil {
			return nil, err
		}
		// As watcher.invoices: past the window, a receiver with a detected deposit is still read until it confirms.
		state.HistoryComplete = state.HistoryComplete || state.PendingDeposits > 0
		state.ChainFinalizedBlock = state.VerifiedBlock
		if at != nil {
			value := time.Unix(*at, 0).UTC()
			state.VerifiedTime = &value
		}
		if unexplained {
			state.ReconciliationError = "unexplained_balance"
		}
		result[state.InvoiceID] = state
	}
	return result, rows.Err()
}
