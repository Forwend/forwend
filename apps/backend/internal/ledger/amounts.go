package ledger

import (
	"context"
	"math/big"

	"github.com/jackc/pgx/v5"
)

type Amounts struct {
	Receiver, Payable, Held, Settled, Refunded, ObservedRefunded *big.Int
	LastReturnTxHash                                             string
	Unreconciled, HasPolicyException                             bool
}

func ReadAmounts(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, invoiceID string) (*Amounts, error) {
	var receiver, payable, held, settled, refunded, observed string
	a := &Amounts{}
	err := db.QueryRow(ctx, `WITH entries AS (
  SELECT t.kind, e.account, e.amount FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
  WHERE t.invoice_id = $1
 ) SELECT coalesce(sum(amount) FILTER (WHERE account = 'receiver'),0)::text,
  (-coalesce(sum(amount) FILTER (WHERE account = 'recipient_payable'),0))::text,
  (-coalesce(sum(amount) FILTER (WHERE account = 'payer_held'),0))::text,
  (-coalesce(sum(amount) FILTER (WHERE account = 'receiver' AND kind = 'settlement'),0))::text,
  (-coalesce(sum(amount) FILTER (WHERE account = 'receiver' AND kind = 'refund'),0))::text,
  coalesce((SELECT sum(amount) FROM receiver_outflows WHERE invoice_id = $1 AND kind = 'refund'),0)::text,
  coalesce((SELECT tx_hash FROM receiver_outflows WHERE invoice_id = $1 AND kind = 'refund'
            ORDER BY block_number DESC,log_index DESC LIMIT 1),'') AS last_return,
 `+UnreconciledSQL("$1")+`,
 EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = $1 AND policy_exception IS NOT NULL)
 FROM entries`, invoiceID).Scan(&receiver, &payable, &held, &settled, &refunded, &observed, &a.LastReturnTxHash, &a.Unreconciled, &a.HasPolicyException)
	if err != nil {
		return nil, err
	}
	a.Receiver, _ = new(big.Int).SetString(receiver, 10)
	a.Payable, _ = new(big.Int).SetString(payable, 10)
	a.Held, _ = new(big.Int).SetString(held, 10)
	a.Settled, _ = new(big.Int).SetString(settled, 10)
	a.Refunded, _ = new(big.Int).SetString(refunded, 10)
	a.ObservedRefunded, _ = new(big.Int).SetString(observed, 10)
	if a.Receiver.Sign() < 0 || a.Payable.Sign() < 0 || a.Held.Sign() < 0 {
		a.Unreconciled = true
	}
	return a, nil
}

// invoiceID is a trusted SQL expression, never request text.
func UnreconciledSQL(invoiceID string) string {
	return `EXISTS (SELECT 1 FROM receiver_scans WHERE invoice_id = ` + invoiceID + ` AND (NOT history_complete OR reconciliation_error IS NOT NULL OR booking_error IS NOT NULL))
 OR EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = ` + invoiceID + ` AND kind <> 'recovery' AND ledger_transaction_id IS NULL)
 OR EXISTS (SELECT 1 FROM chain_transfers d WHERE d.invoice_id = ` + invoiceID + ` AND d.status = 'confirmed'
            AND (NOT d.booked OR NOT EXISTS (SELECT 1 FROM receiver_deposit_proofs p WHERE p.chain_transfer_id = d.id)))
 OR EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.invoice_id = ` + invoiceID + ` AND t.kind IN ('settlement','refund')
            AND NOT EXISTS (SELECT 1 FROM receiver_outflows evidence WHERE evidence.ledger_transaction_id = t.id))
 OR ` + negativeBalancesSQL(invoiceID)

}

func negativeBalancesSQL(invoiceID string) string {
	return `EXISTS (SELECT e.account FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
  WHERE t.invoice_id = ` + invoiceID + ` GROUP BY e.account
  HAVING (e.account = 'receiver' AND sum(e.amount) < 0)
      OR (e.account IN ('payer_held','recipient_payable') AND sum(e.amount) > 0))`
}
