package ledger

import (
	"context"
	"math/big"

	"github.com/jackc/pgx/v5"
)

type ReconciliationStatus string

const (
	ReconciliationVerified ReconciliationStatus = "verified"
	ReconciliationPending  ReconciliationStatus = "pending"
	ReconciliationReview   ReconciliationStatus = "review"
)

type Amounts struct {
	ReconciliationStatus                                         ReconciliationStatus
	Receiver, Payable, Held, Settled, Refunded, ObservedRefunded *big.Int
	LastReturnTxHash                                             string
	Unreconciled, HasPolicyException                             bool
}

func ReadAmounts(ctx context.Context, db interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, invoiceID string) (*Amounts, error) {
	amounts, err := ReadAmountsFor(ctx, db, []string{invoiceID})
	if err != nil {
		return nil, err
	}
	if a, ok := amounts[invoiceID]; ok {
		return a, nil
	}
	return nil, pgx.ErrNoRows
}

func ReadAmountsFor(ctx context.Context, db interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, invoiceIDs []string) (map[string]*Amounts, error) {
	rows, err := db.Query(ctx, `WITH entries AS (
      SELECT t.invoice_id,
        sum(e.amount) FILTER (WHERE e.account = 'receiver') AS receiver,
        -sum(e.amount) FILTER (WHERE e.account = 'recipient_payable') AS payable,
        -sum(e.amount) FILTER (WHERE e.account = 'payer_held') AS held,
        -sum(e.amount) FILTER (WHERE e.account = 'receiver' AND t.kind = 'settlement') AS settled,
        -sum(e.amount) FILTER (WHERE e.account = 'receiver' AND t.kind = 'refund') AS refunded
      FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
      WHERE t.invoice_id = ANY($1::text[]) GROUP BY t.invoice_id
    ) SELECT i.id,coalesce(e.receiver,0)::text,coalesce(e.payable,0)::text,coalesce(e.held,0)::text,
      coalesce(e.settled,0)::text,coalesce(e.refunded,0)::text,
      coalesce((SELECT sum(amount) FROM receiver_outflows WHERE invoice_id = i.id AND kind = 'refund'),0)::text,
      coalesce((SELECT tx_hash FROM receiver_outflows WHERE invoice_id = i.id AND kind = 'refund'
        ORDER BY block_number DESC,log_index DESC LIMIT 1),''),
      `+UnreconciledSQL("i.id")+`,
      EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = i.id AND policy_exception IS NOT NULL),
      `+reconciliationReviewSQL("i.id")+`
    FROM invoices i LEFT JOIN entries e ON e.invoice_id = i.id WHERE i.id = ANY($1::text[])`, invoiceIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]*Amounts, len(invoiceIDs))
	for rows.Next() {
		var id, receiver, payable, held, settled, refunded, observed string
		a := &Amounts{}
		var review bool
		if err := rows.Scan(&id, &receiver, &payable, &held, &settled, &refunded, &observed, &a.LastReturnTxHash, &a.Unreconciled, &a.HasPolicyException, &review); err != nil {
			return nil, err
		}
		a.Receiver, _ = new(big.Int).SetString(receiver, 10)
		a.Payable, _ = new(big.Int).SetString(payable, 10)
		a.Held, _ = new(big.Int).SetString(held, 10)
		a.Settled, _ = new(big.Int).SetString(settled, 10)
		a.Refunded, _ = new(big.Int).SetString(refunded, 10)
		a.ObservedRefunded, _ = new(big.Int).SetString(observed, 10)
		a.ReconciliationStatus = ReconciliationVerified
		if a.Unreconciled {
			a.ReconciliationStatus = ReconciliationPending
			if review {
				a.ReconciliationStatus = ReconciliationReview
			}
		}
		if a.HasPolicyException {
			a.ReconciliationStatus = ReconciliationReview
		}
		result[id] = a
	}
	return result, rows.Err()
}

// UnreconciledSQL: a movement the ledger has not booked yet, an outflow it refused, a balance it can't explain, or a
// negative balance. invoiceID is a trusted SQL expression, never request text.
func UnreconciledSQL(invoiceID string) string {
	return `EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = ` + invoiceID + ` AND kind <> 'recovery' AND ledger_transaction_id IS NULL)
 OR EXISTS (SELECT 1 FROM chain_transfers d WHERE d.invoice_id = ` + invoiceID + ` AND d.status = 'confirmed' AND NOT d.booked)
 OR EXISTS (SELECT 1 FROM invoice_balance_alerts WHERE invoice_id = ` + invoiceID + `)
 OR ` + negativeBalancesSQL(invoiceID)
}

func negativeBalancesSQL(invoiceID string) string {
	return `EXISTS (SELECT e.account FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
  WHERE t.invoice_id = ` + invoiceID + ` GROUP BY e.account
  HAVING (e.account = 'receiver' AND sum(e.amount) < 0)
      OR (e.account IN ('payer_held','recipient_payable') AND sum(e.amount) > 0))`
}

// reconciliationReviewSQL: what an operator must look at, as opposed to work the next round does.
func reconciliationReviewSQL(invoiceID string) string {
	return `EXISTS (SELECT 1 FROM invoice_balance_alerts review_alert WHERE review_alert.invoice_id = ` + invoiceID + `)
 OR (` + negativeBalancesSQL(invoiceID) + `)
 OR EXISTS (SELECT 1 FROM receiver_outflows review_flow WHERE review_flow.invoice_id = ` + invoiceID + ` AND review_flow.ledger_transaction_id IS NULL AND review_flow.kind <> 'recovery' AND review_flow.reconciliation_error NOT IN ('','awaiting_booking'))`
}
