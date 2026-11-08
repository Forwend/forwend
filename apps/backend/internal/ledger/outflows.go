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

// pendingMovements are booked in chain order: one waits while an earlier deposit is still detected, so the earliest
// payers are paid to the creator first and later ones held (D-27).
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
 NOT EXISTS (SELECT 1 FROM chain_transfers d WHERE d.invoice_id=$1 AND d.status='detected'
             AND (d.block_number,d.log_index)<(m.block_number,m.log_index))
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

func outflowRefusal(ctx context.Context, tx pgx.Tx, id int64, reason string) (bool, error) {
	_, err := tx.Exec(ctx, `UPDATE receiver_outflows SET reconciliation_error = $2 WHERE id = $1
  AND ledger_transaction_id IS NULL`, id, reason)
	return false, err
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

// bookOutflow books a settlement as the amount less the fees, and each fee as its own kind (R-230).
func bookOutflow(ctx context.Context, tx pgx.Tx, invoiceID string, m movement, amount *big.Int, shown bool) (bool, error) {
	var token, intended, destination, recipient, hash, reason, networkFee, platformFee string
	if err := tx.QueryRow(ctx, `SELECT o.token_contract, i.token_contract, o.destination, i.recipient_address,
  o.tx_hash, o.reconciliation_error, i.network_fee::text, i.platform_fee::text
  FROM receiver_outflows o JOIN invoices i ON i.id = o.invoice_id WHERE o.id = $1`, m.ID).
		Scan(&token, &intended, &destination, &recipient, &hash, &reason, &networkFee, &platformFee); err != nil {
		return false, err
	}
	value, _ := new(big.Int).SetString(m.Amount, 10)
	network, _ := new(big.Int).SetString(networkFee, 10)
	platform, _ := new(big.Int).SetString(platformFee, 10)
	want := map[string]*big.Int{"settlement": new(big.Int).Sub(amount, new(big.Int).Add(network, platform)),
		"network_fee": network, "platform_fee": platform}[m.Kind]
	if token != intended || (reason == "invalid_terms" || reason == "transfer_evidence_missing") ||
		m.Kind == "settlement" && destination != recipient || want != nil && value.Cmp(want) != 0 {
		return outflowRefusal(ctx, tx, m.ID, "invalid_terms")
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
	// A movement found late, after later ones were booked, would take today's balances instead of its own.
	var later bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_transfers WHERE invoice_id = $1 AND booked
  AND (block_number, log_index) > ($2,$3)) OR EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = $1
  AND ledger_transaction_id IS NOT NULL AND (block_number, log_index) > ($2,$3))`,
		invoiceID, m.BlockNumber, m.LogIndex).Scan(&later); err != nil {
		return false, err
	}
	if later {
		return outflowRefusal(ctx, tx, m.ID, "historical_order")
	}
	// Movements are booked in chain order, so the current balances are the ones just before this movement.
	receiver, err := accountBalance(ctx, tx, invoiceID, "receiver")
	if err != nil {
		return false, err
	}
	payable, err := currentPayable(ctx, tx, invoiceID)
	if err != nil {
		return false, err
	}
	held, err := accountBalance(ctx, tx, invoiceID, "payer_held")
	if err != nil {
		return false, err
	}
	held.Neg(held)
	if receiver.Cmp(value) < 0 {
		return outflowRefusal(ctx, tx, m.ID, "unexplained_outflow")
	}
	fromHeld, fromPayable := new(big.Int), new(big.Int)
	policy := ""
	if m.Kind == "refund" {
		fromHeld.Set(minInt(value, held))
		fromPayable.Sub(value, fromHeld)
		if fromPayable.Sign() > 0 {
			policy = "refund_consumed_payable"
		}
	} else {
		fromPayable.Set(minInt(value, payable))
		fromHeld.Sub(value, fromPayable)
		if fromHeld.Sign() > 0 {
			policy = "settlement_consumed_held"
		}
	}
	if fromHeld.Cmp(held) > 0 || fromPayable.Cmp(payable) > 0 {
		return outflowRefusal(ctx, tx, m.ID, "unexplained_outflow")
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
	if m.Kind == "network_fee" || m.Kind == "platform_fee" {
		return true, nil
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
	// What reached the wallet: the amount less the fees (R-228).
	if err := outbox.Queue(ctx, tx, outbox.Settled, invoiceID, value); err != nil {
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
