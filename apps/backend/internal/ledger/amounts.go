package ledger

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
)

type querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type ReconciliationStatus string

const (
	ReconciliationVerified ReconciliationStatus = "verified"
	ReconciliationPending  ReconciliationStatus = "pending"
	ReconciliationReview   ReconciliationStatus = "review"
)

// Amounts are an option's booked balances and outflows; Fees went to the settler and the refund authority.
type Amounts struct {
	ReconciliationStatus                                               ReconciliationStatus
	Receiver, Payable, Held, Settled, Fees, Refunded, ObservedRefunded *big.Int
	LastReturnTxHash                                                   string
	Unreconciled, HasPolicyException                                   bool
}

func ReadAmounts(ctx context.Context, db querier, invoiceID string) (*Amounts, error) {
	amounts, err := ReadAmountsFor(ctx, db, []string{invoiceID})
	if err != nil {
		return nil, err
	}
	if a, ok := amounts[invoiceID]; ok {
		return a, nil
	}
	return nil, pgx.ErrNoRows
}

func ReadAmountsFor(ctx context.Context, db querier, invoiceIDs []string) (map[string]*Amounts, error) {
	rows, err := db.Query(ctx, `WITH entries AS (
      SELECT t.invoice_id,
        sum(e.amount) FILTER (WHERE e.account = 'receiver') AS receiver,
        -sum(e.amount) FILTER (WHERE e.account = 'recipient_payable') AS payable,
        -sum(e.amount) FILTER (WHERE e.account = 'payer_held') AS held,
        -sum(e.amount) FILTER (WHERE e.account = 'receiver' AND t.kind = 'settlement') AS settled,
        -sum(e.amount) FILTER (WHERE e.account = 'receiver' AND t.kind IN ('network_fee', 'platform_fee')) AS fees,
        -sum(e.amount) FILTER (WHERE e.account = 'receiver' AND t.kind = 'refund') AS refunded
      FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
      WHERE t.invoice_id = ANY($1::text[]) GROUP BY t.invoice_id
    ) SELECT i.id,coalesce(e.receiver,0)::text,coalesce(e.payable,0)::text,coalesce(e.held,0)::text,
      coalesce(e.settled,0)::text,coalesce(e.fees,0)::text,coalesce(e.refunded,0)::text,
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
		var id, receiver, payable, held, settled, fees, refunded, observed string
		a := &Amounts{}
		var review bool
		if err := rows.Scan(&id, &receiver, &payable, &held, &settled, &fees, &refunded, &observed, &a.LastReturnTxHash, &a.Unreconciled, &a.HasPolicyException, &review); err != nil {
			return nil, err
		}
		a.Receiver, _ = new(big.Int).SetString(receiver, 10)
		a.Payable, _ = new(big.Int).SetString(payable, 10)
		a.Held, _ = new(big.Int).SetString(held, 10)
		a.Settled, _ = new(big.Int).SetString(settled, 10)
		a.Fees, _ = new(big.Int).SetString(fees, 10)
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

// UnreconciledSQL: unbooked movements, refused outflows, unexplained or negative balances; trusted SQL only.
func UnreconciledSQL(invoiceID string) string {
	return SettleWaitsSQL(invoiceID) + `
 OR EXISTS (SELECT 1 FROM invoice_balance_alerts WHERE invoice_id = ` + invoiceID + ` AND excess)`
}

// SettleWaitsSQL is UnreconciledSQL less unbooked money on chain: settle pays only the amount, the rest stays held.
func SettleWaitsSQL(invoiceID string) string {
	return `EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = ` + invoiceID + ` AND kind <> 'recovery' AND ledger_transaction_id IS NULL)
 OR EXISTS (SELECT 1 FROM chain_transfers d WHERE d.invoice_id = ` + invoiceID + ` AND d.status = 'confirmed' AND NOT d.booked)
 OR EXISTS (SELECT 1 FROM invoice_balance_alerts WHERE invoice_id = ` + invoiceID + ` AND NOT excess)
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

// OwedSQL is what the owner is owed on option, an SQL id; no settlement runs before the amount is all in.
func OwedSQL(option string) string {
	return `(SELECT -coalesce(sum(owed_e.amount), 0) FROM ledger_entries owed_e
		JOIN ledger_transactions owed_t ON owed_t.id = owed_e.transaction_id
		WHERE owed_t.invoice_id = ` + option + ` AND owed_e.account = 'recipient_payable')`
}

// OwedNotPaid lists invoices owed in full, last booked before after, yet not paid: the balance check keeps failing.
func OwedNotPaid(ctx context.Context, db querier, after time.Duration) ([]string, error) {
	rows, err := db.Query(ctx, `SELECT i.id FROM invoices i
		WHERE i.payment_status IN ('detected', 'partially_paid')
		  AND `+OwedSQL("i.id")+` >= i.amount
		  AND (SELECT max(t.created_at) FROM ledger_transactions t WHERE t.invoice_id = i.id) < now() - $1 * interval '1 second'
		ORDER BY i.id LIMIT 20`, int64(after/time.Second))
	if err != nil {
		return nil, fmt.Errorf("read invoices owed but not paid: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
