package invoice

import (
	"context"
	"math/big"
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/jackc/pgx/v5"
)

type PaymentBalances struct{ Receiver, Payable, Held *big.Int }

type ReconciliationAsset struct {
	StoreID, StoreName string
	chain.Asset
	Livemode                                                                                                                      bool
	Opening, Changes, Closing                                                                                                     PaymentBalances
	Settled, Fees, Refunded                                                                                                       *big.Int
	CheckpointBalance, CheckpointDifference                                                                                       *big.Int
	ReceiverCount, VerifiedReceivers, UnreconciledReceivers                                                                       int64
	PendingDeposits, UnbookedDeposits, UnprovedDeposits, UnbookedOutflows, OtherAssetMovements, PolicyExceptions, BookedMovements int64
	MinVerifiedBlock, MaxVerifiedBlock, ChainFinalizedBlock                                                                       *uint64
}

type PaymentReconciliation struct {
	SnapshotAt time.Time
	From, To   time.Time
	Assets     []ReconciliationAsset
}

func (s *Service) PaymentReconciliation(ctx context.Context, profileID string, q MovementQuery) (PaymentReconciliation, error) {
	q.After = ""
	args, scope, err := paymentScope(profileID, q)
	if err != nil {
		return PaymentReconciliation{}, err
	}
	args[1] = MaxPaymentExportRows + 1
	scopeArgs := args
	args, _, err = movementWhere(q, args)
	if err != nil {
		return PaymentReconciliation{}, err
	}
	from, to := len(args)-1, len(args)
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return PaymentReconciliation{}, err
	}
	defer tx.Rollback(ctx)
	if q.PaymentID != "" {
		var exists bool
		if err := tx.QueryRow(ctx, "WITH "+scope+" SELECT EXISTS (SELECT 1 FROM payment_scope) AND $2::int > 0", scopeArgs...).Scan(&exists); err != nil {
			return PaymentReconciliation{}, err
		}
		if !exists {
			return PaymentReconciliation{}, ErrPaymentNotFound
		}
	}
	result := PaymentReconciliation{From: q.From, To: q.To, Assets: []ReconciliationAsset{}}
	if err := tx.QueryRow(ctx, "SELECT transaction_timestamp()").Scan(&result.SnapshotAt); err != nil {
		return PaymentReconciliation{}, err
	}
	sql := reconciliationSQL(scope, from, to)
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return PaymentReconciliation{}, err
	}
	for rows.Next() {
		asset, err := scanReconciliationAsset(rows)
		if err != nil {
			rows.Close()
			return PaymentReconciliation{}, err
		}
		if !q.To.Before(result.SnapshotAt) && asset.CheckpointBalance != nil {
			asset.CheckpointDifference = new(big.Int).Sub(asset.CheckpointBalance, asset.Closing.Receiver)
		}
		result.Assets = append(result.Assets, asset)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return PaymentReconciliation{}, err
	}
	if len(result.Assets) > MaxPaymentExportRows {
		return PaymentReconciliation{}, ErrTooManyMovements
	}
	return result, tx.Commit(ctx)
}

func reconciliationSQL(scope string, from, to int) string {
	lower, upper := "$"+strconv.Itoa(from), "$"+strconv.Itoa(to)
	return "WITH " + scope + `, options AS (
 SELECT i.id,i.chain_id,i.token_contract,p.store_id,p.store_name FROM invoices i
 JOIN payment_scope p ON p.id = coalesce(i.main_id,i.id)
 ), entries AS (
 SELECT t.invoice_id,
 coalesce(sum(e.amount) FILTER (WHERE e.account = 'receiver' AND t.created_at < ` + lower + `),0) AS opening_receiver,
 -coalesce(sum(e.amount) FILTER (WHERE e.account = 'recipient_payable' AND t.created_at < ` + lower + `),0) AS opening_payable,
 -coalesce(sum(e.amount) FILTER (WHERE e.account = 'payer_held' AND t.created_at < ` + lower + `),0) AS opening_held,
 coalesce(sum(e.amount) FILTER (WHERE e.account = 'receiver' AND t.created_at >= ` + lower + `),0) AS receiver_change,
 -coalesce(sum(e.amount) FILTER (WHERE e.account = 'recipient_payable' AND t.created_at >= ` + lower + `),0) AS payable_change,
 -coalesce(sum(e.amount) FILTER (WHERE e.account = 'payer_held' AND t.created_at >= ` + lower + `),0) AS held_change,
 coalesce(sum(e.amount) FILTER (WHERE e.account = 'receiver'),0) AS closing_receiver,
 -coalesce(sum(e.amount) FILTER (WHERE e.account = 'recipient_payable'),0) AS closing_payable,
 -coalesce(sum(e.amount) FILTER (WHERE e.account = 'payer_held'),0) AS closing_held,
 -coalesce(sum(e.amount) FILTER (WHERE e.account = 'receiver' AND t.kind = 'settlement' AND t.created_at >= ` + lower + `),0) AS settled,
 -coalesce(sum(e.amount) FILTER (WHERE e.account = 'receiver' AND t.kind IN ('network_fee','platform_fee') AND t.created_at >= ` + lower + `),0) AS fees,
 -coalesce(sum(e.amount) FILTER (WHERE e.account = 'receiver' AND t.kind = 'refund' AND t.created_at >= ` + lower + `),0) AS refunded,
 count(DISTINCT t.id) FILTER (WHERE t.created_at >= ` + lower + `) AS movements
 FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN options receiver ON receiver.id = t.invoice_id
 WHERE t.created_at < ` + upper + ` GROUP BY t.invoice_id
 ), evidence AS (
 SELECT receiver.id,cur.last_finalized_block AS scanned_block,
 (` + ledger.UnreconciledSQL("receiver.id") + `) AS unreconciled,
 EXISTS (SELECT 1 FROM invoice_balance_alerts a WHERE a.invoice_id = receiver.id AND a.excess) AS missed,
 (SELECT count(*) FROM chain_transfers d WHERE d.invoice_id = receiver.id AND d.status = 'detected') AS pending,
 (SELECT count(*) FROM chain_transfers d WHERE d.invoice_id = receiver.id AND d.status = 'confirmed' AND NOT d.booked) AS unbooked,
 (SELECT count(*) FROM receiver_outflows flow WHERE flow.invoice_id = receiver.id AND flow.kind <> 'recovery' AND flow.ledger_transaction_id IS NULL) AS outflows,
 (SELECT count(*) FROM receiver_outflows flow WHERE flow.invoice_id = receiver.id AND flow.kind = 'recovery') AS other_assets,
 (SELECT count(*) FROM receiver_outflows flow WHERE flow.invoice_id = receiver.id AND flow.policy_exception IS NOT NULL) AS exceptions
 FROM options receiver LEFT JOIN chain_cursors cur ON cur.chain_id = receiver.chain_id
 ) SELECT coalesce(receiver.store_id::text,''),receiver.store_name,receiver.chain_id,receiver.token_contract,token.symbol,token.decimals,c.livemode,
 coalesce(sum(e.opening_receiver),0)::text,coalesce(sum(e.opening_payable),0)::text,coalesce(sum(e.opening_held),0)::text,
 coalesce(sum(e.receiver_change),0)::text,coalesce(sum(e.payable_change),0)::text,coalesce(sum(e.held_change),0)::text,
 coalesce(sum(e.closing_receiver),0)::text,coalesce(sum(e.closing_payable),0)::text,coalesce(sum(e.closing_held),0)::text,
 coalesce(sum(e.settled),0)::text,coalesce(sum(e.fees),0)::text,coalesce(sum(e.refunded),0)::text,
 NULL::text,
 count(*),count(*) FILTER (WHERE NOT proof.unreconciled),count(*) FILTER (WHERE proof.unreconciled),
 coalesce(sum(proof.pending),0)::bigint,coalesce(sum(proof.unbooked),0)::bigint,count(*) FILTER (WHERE proof.missed),
 coalesce(sum(proof.outflows),0)::bigint,coalesce(sum(proof.other_assets),0)::bigint,coalesce(sum(proof.exceptions),0)::bigint,
 coalesce(sum(e.movements),0)::bigint,min(proof.scanned_block),max(proof.scanned_block),max(progress.last_finalized_block)
 FROM options receiver JOIN tokens token ON token.chain_id = receiver.chain_id AND token.contract = receiver.token_contract JOIN chains c ON c.chain_id = receiver.chain_id
 LEFT JOIN entries e ON e.invoice_id = receiver.id JOIN evidence proof ON proof.id = receiver.id LEFT JOIN chain_cursors progress ON progress.chain_id = receiver.chain_id
 GROUP BY receiver.store_id,receiver.store_name,receiver.chain_id,receiver.token_contract,token.symbol,token.decimals,c.livemode
 ORDER BY receiver.store_id NULLS FIRST,receiver.chain_id,receiver.token_contract LIMIT $2`
}

func scanReconciliationAsset(row pgx.CollectableRow) (ReconciliationAsset, error) {
	var asset ReconciliationAsset
	var texts [12]string
	var checkpoint *string
	err := row.Scan(&asset.StoreID, &asset.StoreName, &asset.ChainID, &asset.Token, &asset.Symbol, &asset.Decimals, &asset.Livemode,
		&texts[0], &texts[1], &texts[2], &texts[3], &texts[4], &texts[5], &texts[6], &texts[7], &texts[8], &texts[9], &texts[10], &texts[11], &checkpoint,
		&asset.ReceiverCount, &asset.VerifiedReceivers, &asset.UnreconciledReceivers, &asset.PendingDeposits, &asset.UnbookedDeposits, &asset.UnprovedDeposits,
		&asset.UnbookedOutflows, &asset.OtherAssetMovements, &asset.PolicyExceptions, &asset.BookedMovements, &asset.MinVerifiedBlock, &asset.MaxVerifiedBlock, &asset.ChainFinalizedBlock)
	if err != nil {
		return ReconciliationAsset{}, err
	}
	targets := []**big.Int{&asset.Opening.Receiver, &asset.Opening.Payable, &asset.Opening.Held, &asset.Changes.Receiver, &asset.Changes.Payable, &asset.Changes.Held,
		&asset.Closing.Receiver, &asset.Closing.Payable, &asset.Closing.Held, &asset.Settled, &asset.Fees, &asset.Refunded}
	for i, target := range targets {
		*target, _ = new(big.Int).SetString(texts[i], 10)
	}
	if checkpoint != nil {
		asset.CheckpointBalance, _ = new(big.Int).SetString(*checkpoint, 10)
	}
	return asset, nil
}
