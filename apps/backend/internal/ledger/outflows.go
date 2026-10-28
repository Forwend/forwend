package ledger

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

type movement struct {
	ID                    int64
	Kind, Amount          string
	BlockTime             int64
	BlockNumber, LogIndex uint64
}

const MovementBatch = 100

func pendingMovements(ctx context.Context, tx pgx.Tx, invoiceID string) ([]movement, bool, error) {
	rows, err := tx.Query(ctx, `WITH candidates AS MATERIALIZED (
 SELECT * FROM (
  (SELECT id,'deposit' AS kind,amount::text,block_time,block_number,log_index FROM chain_transfers
   WHERE invoice_id=$1 AND status='confirmed' AND NOT booked ORDER BY block_number,log_index LIMIT $2)
  UNION ALL
  (SELECT id,kind,amount::text,block_time,block_number,log_index FROM receiver_outflows
   WHERE invoice_id=$1 AND ledger_transaction_id IS NULL AND kind<>'recovery'
   ORDER BY block_number,log_index LIMIT $2)
 ) pending ORDER BY block_number,log_index LIMIT $2
 ) SELECT m.*,
 (m.kind<>'deposit' OR NOT EXISTS (SELECT 1 FROM chain_transfers d WHERE d.invoice_id=$1 AND d.status='detected'
                                 AND (d.block_number,d.log_index)<(m.block_number,m.log_index)))
 AND NOT EXISTS (SELECT 1 FROM receiver_scans s WHERE s.invoice_id=$1 AND s.opening_checked
   AND (m.block_number>s.scanned_block OR (m.kind='deposit' AND NOT EXISTS (
     SELECT 1 FROM receiver_deposit_proofs p WHERE p.chain_transfer_id=m.id))))
 FROM candidates m ORDER BY m.block_number,m.log_index`, invoiceID, MovementBatch+1)
	if err != nil {
		return nil, false, fmt.Errorf("read invoice %s movements: %w", invoiceID, err)
	}
	defer rows.Close()
	movements := make([]movement, 0, MovementBatch)
	more := false
	for rows.Next() {
		var m movement
		var eligible bool
		if err := rows.Scan(&m.ID, &m.Kind, &m.Amount, &m.BlockTime, &m.BlockNumber, &m.LogIndex, &eligible); err != nil {
			return nil, false, err
		}
		if !eligible || len(movements) == MovementBatch {
			more = true
			break
		}
		movements = append(movements, m)
	}
	return movements, more, rows.Err()
}

type prefixBalances struct{ receiver, payable, held *big.Int }

func depositOnlyBalances(ctx context.Context, tx pgx.Tx, invoiceID string) (*prefixBalances, error) {
	var other bool
	var receiver, payable, held string
	err := tx.QueryRow(ctx, `SELECT
 EXISTS (SELECT 1 FROM ledger_transactions WHERE invoice_id=$1 AND kind<>'deposit'),
 coalesce(sum(e.amount) FILTER (WHERE e.account='receiver'),0)::text,
 (-coalesce(sum(e.amount) FILTER (WHERE e.account='recipient_payable'),0))::text,
 (-coalesce(sum(e.amount) FILTER (WHERE e.account='payer_held'),0))::text
 FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id WHERE t.invoice_id=$1`, invoiceID).
		Scan(&other, &receiver, &payable, &held)
	if err != nil || other {
		return nil, err
	}
	b := &prefixBalances{}
	b.receiver, _ = new(big.Int).SetString(receiver, 10)
	b.payable, _ = new(big.Int).SetString(payable, 10)
	b.held, _ = new(big.Int).SetString(held, 10)
	return b, nil
}

// Non-cash expiry follows the checkout close; reopening follows its recorded verified checkpoint.
func balancesBefore(ctx context.Context, tx pgx.Tx, invoiceID string, m movement) (prefixBalances, string, error) {
	var unknown bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (
  SELECT 1 FROM ledger_transactions t LEFT JOIN ledger_checkpoints p ON p.transaction_id = t.id
  LEFT JOIN receiver_outflows o ON o.ledger_transaction_id = t.id WHERE t.invoice_id = $1
  AND ((t.kind = 'reopen' AND p.transaction_id IS NULL) OR t.kind = 'reversal'
       OR (t.kind IN ('settlement', 'refund') AND o.id IS NULL)))`, invoiceID).Scan(&unknown); err != nil {
		return prefixBalances{}, "", err
	}
	if unknown {
		return prefixBalances{}, "historical_position_unknown", nil
	}
	var r, p, h string
	err := tx.QueryRow(ctx, `WITH positioned AS (
  SELECT t.*, row_number() OVER (PARTITION BY t.kind ORDER BY t.id) AS occurrence
  FROM ledger_transactions t WHERE t.invoice_id = $1
 ), preceding AS (
  SELECT t.id FROM positioned t JOIN invoices i ON i.id = t.invoice_id
  LEFT JOIN chain_transfers d ON d.id = t.chain_transfer_id
  LEFT JOIN receiver_outflows o ON o.ledger_transaction_id = t.id
  LEFT JOIN ledger_checkpoints c ON c.transaction_id = t.id
  WHERE (t.kind = 'deposit' AND (d.block_number, d.log_index) < ($2,$3))
   OR (t.kind IN ('settlement', 'refund') AND (o.block_number, o.log_index) < ($2,$3))
   OR (t.kind = 'expiry' AND $4 > CASE WHEN t.occurrence = 1 THEN least(i.expires_at,i.closes_at) ELSE i.closes_at END)
   OR (t.kind = 'reopen' AND c.block_number < $2)
 ) SELECT coalesce(sum(e.amount) FILTER (WHERE e.account = 'receiver'), 0)::text,
  (-coalesce(sum(e.amount) FILTER (WHERE e.account = 'recipient_payable'), 0))::text,
  (-coalesce(sum(e.amount) FILTER (WHERE e.account = 'payer_held'), 0))::text
 FROM ledger_entries e JOIN preceding p ON p.id = e.transaction_id`, invoiceID, m.BlockNumber, m.LogIndex, m.BlockTime).Scan(&r, &p, &h)
	if err != nil {
		return prefixBalances{}, "", err
	}
	b := prefixBalances{}
	b.receiver, _ = new(big.Int).SetString(r, 10)
	b.payable, _ = new(big.Int).SetString(p, 10)
	b.held, _ = new(big.Int).SetString(h, 10)
	if b.receiver.Sign() < 0 || b.payable.Sign() < 0 || b.held.Sign() < 0 ||
		b.receiver.Cmp(new(big.Int).Add(b.payable, b.held)) != 0 {
		return b, "historical_allocation_conflict", nil
	}
	return b, "", nil
}

func receiverEvidence(ctx context.Context, tx pgx.Tx, invoiceID string, block uint64) (bool, error) {
	var ready bool
	err := tx.QueryRow(ctx, `SELECT opening_checked AND scanned_block >= $2 AND reconciliation_error IS NULL AND booking_error IS NULL
  FROM receiver_scans WHERE invoice_id = $1`, invoiceID, block).Scan(&ready)
	return ready, err
}

func outflowRefusal(ctx context.Context, tx pgx.Tx, id int64, reason string) (bool, error) {
	_, err := tx.Exec(ctx, `UPDATE receiver_outflows SET reconciliation_error = $2 WHERE id = $1
  AND ledger_transaction_id IS NULL`, id, reason)
	return false, err
}

func captureFunding(ctx context.Context, tx pgx.Tx, invoiceID string, before movement, target *big.Int, known *prefixBalances) (bool, error) {
	ready, err := receiverEvidence(ctx, tx, invoiceID, before.BlockNumber)
	if err != nil || !ready {
		return false, err
	}
	b := known
	if b == nil {
		balances, reason, err := balancesBefore(ctx, tx, invoiceID, before)
		if err != nil || reason != "" {
			return false, err
		}
		b = &balances
	}
	if b.payable.Cmp(target) < 0 || b.receiver.Cmp(target) < 0 {
		return false, nil
	}
	_, err = tx.Exec(ctx, `INSERT INTO receiver_funding (invoice_id, chain_transfer_id, verified_block, verified_hash)
  SELECT $1, d.id, s.scanned_block, s.scanned_hash FROM chain_transfers d JOIN receiver_scans s ON s.invoice_id = d.invoice_id
  JOIN ledger_transactions t ON t.chain_transfer_id = d.id AND t.kind = 'deposit'
  JOIN ledger_entries e ON e.transaction_id = t.id AND e.account = 'recipient_payable' AND e.amount < 0
  WHERE d.invoice_id = $1 AND d.status = 'confirmed' AND (d.block_number, d.log_index) < ($2,$3)
  ORDER BY d.block_number DESC, d.log_index DESC LIMIT 1 ON CONFLICT DO NOTHING`, invoiceID, before.BlockNumber, before.LogIndex)
	if err != nil {
		return false, err
	}
	return hasFunding(ctx, tx, invoiceID)
}

// attachLegacySettlement adds source evidence to an existing append-only booking without moving its money again.
func attachLegacySettlement(ctx context.Context, tx pgx.Tx, invoiceID string) error {
	_, err := tx.Exec(ctx, `UPDATE receiver_outflows o SET ledger_transaction_id = t.id, reconciliation_error = '',
  policy_exception = CASE WHEN EXISTS (SELECT 1 FROM ledger_entries held WHERE held.transaction_id = t.id
     AND held.account = 'payer_held' AND held.amount > 0) THEN 'settlement_consumed_held' ELSE NULL END
  FROM ledger_transactions t JOIN invoices i ON i.id = t.invoice_id
  JOIN ledger_entries e ON e.transaction_id = t.id AND e.account = 'receiver'
  WHERE t.invoice_id = $1 AND t.kind = 'settlement' AND o.invoice_id = t.invoice_id AND o.kind = 'settlement'
  AND o.ledger_transaction_id IS NULL AND o.destination = i.recipient_address AND o.token_contract = i.token_contract
  AND o.amount = i.amount AND e.amount = -o.amount AND o.transfer_log_index IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM receiver_outflows linked WHERE linked.ledger_transaction_id = t.id)`, invoiceID)
	return err
}

func bookOutflow(ctx context.Context, tx pgx.Tx, invoiceID string, m movement, target *big.Int, shown bool) (bool, error) {
	var token, intended, destination, recipient, hash, reason string
	if err := tx.QueryRow(ctx, `SELECT o.token_contract, i.token_contract, o.destination, i.recipient_address,
  o.tx_hash, o.reconciliation_error FROM receiver_outflows o JOIN invoices i ON i.id = o.invoice_id WHERE o.id = $1`, m.ID).
		Scan(&token, &intended, &destination, &recipient, &hash, &reason); err != nil {
		return false, err
	}
	value, _ := new(big.Int).SetString(m.Amount, 10)
	if token != intended || (reason == "invalid_terms" || reason == "transfer_evidence_missing") || m.Kind == "settlement" && (destination != recipient || value.Cmp(target) != 0) {
		return outflowRefusal(ctx, tx, m.ID, "invalid_terms")
	}
	ready, err := receiverEvidence(ctx, tx, invoiceID, m.BlockNumber)
	if err != nil {
		return false, err
	}
	if !ready {
		return outflowRefusal(ctx, tx, m.ID, "awaiting_coverage")
	}
	var predecessor bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = $1
  AND kind <> 'recovery' AND ledger_transaction_id IS NULL AND (block_number, log_index) < ($2,$3))`,
		invoiceID, m.BlockNumber, m.LogIndex).Scan(&predecessor); err != nil {
		return false, err
	}
	if predecessor {
		return outflowRefusal(ctx, tx, m.ID, "unresolved_predecessor")
	}
	b, failure, err := balancesBefore(ctx, tx, invoiceID, m)
	if err != nil {
		return false, err
	}
	if failure != "" {
		return outflowRefusal(ctx, tx, m.ID, failure)
	}
	if b.receiver.Cmp(value) < 0 {
		return outflowRefusal(ctx, tx, m.ID, "unexplained_outflow")
	}
	fromHeld, fromPayable := new(big.Int), new(big.Int)
	policy := ""
	if m.Kind == "refund" {
		fromHeld.Set(minInt(value, b.held))
		fromPayable.Sub(value, fromHeld)
		if fromPayable.Sign() > 0 {
			policy = "refund_consumed_payable"
		}
	} else {
		fromPayable.Set(minInt(value, b.payable))
		fromHeld.Sub(value, fromPayable)
		if fromHeld.Sign() > 0 {
			policy = "settlement_consumed_held"
		}
	}
	if fromHeld.Cmp(b.held) > 0 || fromPayable.Cmp(b.payable) > 0 {
		return outflowRefusal(ctx, tx, m.ID, "unexplained_outflow")
	}
	for account, used := range map[string]*big.Int{"receiver": value, "recipient_payable": fromPayable, "payer_held": fromHeld} {
		current, err := accountBalance(ctx, tx, invoiceID, account)
		if err != nil {
			return false, err
		}
		if account != "receiver" {
			current.Neg(current)
		}
		if current.Cmp(used) < 0 {
			return outflowRefusal(ctx, tx, m.ID, "historical_allocation_conflict")
		}
	}
	if fromPayable.Sign() > 0 && b.payable.Cmp(target) < 0 {
		var future bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_transfers d JOIN ledger_transactions t
   ON t.chain_transfer_id = d.id AND t.kind = 'deposit' JOIN ledger_entries e ON e.transaction_id = t.id
   WHERE d.invoice_id = $1 AND (d.block_number,d.log_index) > ($2,$3)
   AND e.account = 'recipient_payable' AND e.amount < 0)`, invoiceID, m.BlockNumber, m.LogIndex).Scan(&future); err != nil {
			return false, err
		}
		if future {
			return outflowRefusal(ctx, tx, m.ID, "historical_allocation_conflict")
		}
	}
	tid, err := bookTransaction(ctx, tx, invoiceID, m.Kind, nil, new(big.Int).Neg(value),
		new(big.Int).Neg(fromPayable), new(big.Int).Neg(fromHeld))
	if err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `UPDATE receiver_outflows SET ledger_transaction_id = $2, reconciliation_error = '',
  policy_exception = nullif($3, '') WHERE id = $1`, m.ID, tid, policy); err != nil {
		return false, err
	}
	if m.Kind == "refund" {
		data := history.Data{Amount: value.String(), TxHash: hash, Reason: policy}
		if !shown {
			data.Option = invoiceID
		}
		return true, history.Add(ctx, tx, invoiceID, history.Refunded, history.System, data)
	}
	if _, err := tx.Exec(ctx, `WITH s AS (UPDATE settlement_intents SET status = 'confirmed', tx_hash = $2,
  reason = NULL, wait = NULL, updated_at = now() WHERE invoice_id = $1)
  UPDATE invoices SET settlement_status = 'settled' WHERE id = $1`, invoiceID, hash); err != nil {
		return false, err
	}
	if !shown || policy != "" {
		return true, history.Add(ctx, tx, invoiceID, history.ReceiverSettled, history.System,
			history.Data{Amount: value.String(), TxHash: hash, Reason: policy, Option: invoiceID})
	}
	if err := outbox.Queue(ctx, tx, outbox.Settled, invoiceID, nil); err != nil {
		return false, err
	}
	return true, history.Add(ctx, tx, invoiceID, history.Settled, history.System, history.Data{TxHash: hash, Reason: policy})
}

func minInt(a, b *big.Int) *big.Int {
	if a.Cmp(b) < 0 {
		return a
	}
	return b
}

func currentPayable(ctx context.Context, tx pgx.Tx, invoiceID string) (*big.Int, error) {
	n, err := accountBalance(ctx, tx, invoiceID, "recipient_payable")
	if err != nil {
		return nil, err
	}
	return n.Neg(n), nil
}

func hasFunding(ctx context.Context, tx pgx.Tx, invoiceID string) (bool, error) {
	var funded bool
	err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM receiver_funding WHERE invoice_id = $1)", invoiceID).Scan(&funded)
	return funded, err
}

func ensureNoReturnedFunds(ctx context.Context, tx pgx.Tx, invoiceID string) error {
	var returned bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = $1 AND kind IN ('refund','settlement'))`, invoiceID).Scan(&returned)
	if err != nil {
		return err
	}
	if returned {
		return errors.New("confirmed return prevents reopening")
	}
	return nil
}

func recordHistoricalPaid(ctx context.Context, tx pgx.Tx, invoiceID string, shown bool) error {
	if _, err := tx.Exec(ctx, "UPDATE invoices SET payment_status = 'paid' WHERE id = $1", invoiceID); err != nil {
		return err
	}
	if shown {
		if err := history.Add(ctx, tx, invoiceID, "invoice.paid", history.System, history.Data{}); err != nil {
			return err
		}
	}
	if err := outbox.Queue(ctx, tx, outbox.Paid, invoiceID, nil); err != nil {
		return err
	}
	return outbox.QueueReceipt(ctx, tx, invoiceID)
}
