package worker

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

const (
	// AlertEvery bounds how often the alert checks run and log.
	AlertEvery = 5 * time.Minute
	// StalledAfter: a chain's finalized cursor this far behind the clock has stopped. Base and Arbitrum finalize about
	// 20 minutes behind their newest block, Tempo and Arc at once.
	StalledAfter = 45 * time.Minute
	// UnsettledAfter: a paid invoice still not settled waits on something an operator must look at.
	UnsettledAfter = 30 * time.Minute
	// DeadlineSoon: after its settle deadline only the refund authority can move the money, so a day before it alerts.
	DeadlineSoon = 24 * time.Hour
)

// alert logs an ALERT for symptoms that hold money: a chain whose scan stopped, a deposit that stays detected below
// the finalized block, a receiver's settle or refund the ledger can't book, money owed in full that never becomes
// paid, and paid money not settled in time, close to its settle deadline, or past it.
func (w *Worker) alert(ctx context.Context) error {
	rows, err := w.pool.Query(ctx, `SELECT c.chain_id, extract(epoch FROM now())::bigint - cur.last_finalized_time,
		    (SELECT count(*) FROM chain_transfers t WHERE t.chain_id = c.chain_id AND t.status = 'detected'
		     AND t.block_number < cur.last_finalized_block AND t.block_time < cur.last_finalized_time - $1)
		FROM chains c JOIN chain_cursors cur ON cur.chain_id = c.chain_id WHERE c.enabled`, int64(StalledAfter/time.Second))
	if err != nil {
		return fmt.Errorf("read chain progress: %w", err)
	}
	for rows.Next() {
		var id, behind, stuck int64
		if err := rows.Scan(&id, &behind, &stuck); err != nil {
			rows.Close()
			return err
		}
		if behind > int64(StalledAfter/time.Second) {
			slog.Error("ALERT chain scan stalled: its finalized block is far behind the clock", "chain", id,
				"behind", time.Duration(behind)*time.Second)
		}
		if stuck > 0 {
			slog.Error("ALERT deposits stay detected below the finalized block", "chain", id, "deposits", stuck)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	rows, err = w.pool.Query(ctx, `SELECT invoice_id, chain_id, kind, reconciliation_error FROM receiver_outflows
		WHERE ledger_transaction_id IS NULL AND kind <> 'recovery' AND created_at < now() - $1 * interval '1 second'
		ORDER BY created_at LIMIT 20`, int64(UnsettledAfter/time.Second))
	if err != nil {
		return fmt.Errorf("read unbooked receiver events: %w", err)
	}
	for rows.Next() {
		var invoice, kind, reason string
		var chainID int64
		if err := rows.Scan(&invoice, &chainID, &kind, &reason); err != nil {
			rows.Close()
			return err
		}
		slog.Error("ALERT receiver event not booked", "invoice", invoice, "chain", chainID, "kind", kind, "reason", reason)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	owed, err := ledger.OwedNotPaid(ctx, w.pool, StalledAfter)
	if err != nil {
		return err
	}
	for _, invoice := range owed {
		slog.Error("ALERT invoice owed in full is not paid: its finalized balance check keeps failing", "invoice", invoice)
	}
	// A user at the daily settlement cap waits by design; only its deadline makes it alert. Those still before their
	// deadline come first: the executor can still settle them.
	rows, err = w.pool.Query(ctx, `SELECT i.id, i.chain_id, i.factory_address, si.status, coalesce(si.reason, ''),
		    extract(epoch FROM now() - si.created_at)::bigint, i.settle_deadline - extract(epoch FROM now())::bigint
		FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id
		WHERE si.status <> 'confirmed'
		  AND (si.created_at < now() - $1 * interval '1 second' AND si.wait IS DISTINCT FROM 'cap'
		       OR i.settle_deadline < extract(epoch FROM now())::bigint + $2)
		ORDER BY i.settle_deadline <= extract(epoch FROM now())::bigint, i.settle_deadline LIMIT 20`,
		int64(UnsettledAfter/time.Second), int64(DeadlineSoon/time.Second))
	if err != nil {
		return fmt.Errorf("read late settlements: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var invoice, factory, status, reason string
		var chainID, waited, left int64
		if err := rows.Scan(&invoice, &chainID, &factory, &status, &reason, &waited, &left); err != nil {
			return err
		}
		message := "ALERT paid invoice not settled"
		attrs := []any{"invoice", invoice, "chain", chainID, "intent", status, "reason", reason,
			"waited", time.Duration(waited) * time.Second, "deadlineIn", time.Duration(left) * time.Second}
		switch {
		case left <= 0:
			message = "ALERT paid invoice not settled past its settle deadline: only the refund authority can settle it"
			attrs = append(attrs, "factory", factory)
			if known, ok := address.KnownFactory(factory); ok && address.Known[known].RefundAuthority != [20]byte{} {
				attrs = append(attrs, "refundAuthority", common.Address(address.Known[known].RefundAuthority).Hex())
			}
		case left < int64(DeadlineSoon/time.Second):
			message = "ALERT paid invoice not settled close to its settle deadline"
		}
		slog.Error(message, attrs...)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return w.alertCrossChain(ctx)
}

// alertCrossChain logs an ALERT for a cross-chain payment that holds a payer's money (R-234): 1Click failed it in the
// last week, a deposit it saw is unfinished an hour past the deadline, it delivered and no Base deposit with its
// transaction came in 30 minutes, or in the last week another quote of the invoice saw a deposit too: each delivers
// all that is due, so one is held for its payer. Only a quote seen in the last week or still read alerts, so indexes
// find them without reading every quote; the newest come first.
func (w *Worker) alertCrossChain(ctx context.Context) error {
	rows, err := w.pool.Query(ctx, `SELECT c.id::text, c.invoice_id, c.status, twice FROM crosschain_quotes c,
		    LATERAL (SELECT coalesce(c.deposit_seen_at > now() - interval '7 days', false)
		        AND c.status NOT IN ('REFUNDED', 'FAILED') AND EXISTS (SELECT 1 FROM crosschain_quotes o WHERE o.invoice_id = c.invoice_id AND o.id <> c.id
		            AND o.deposit_seen_at IS NOT NULL AND o.status NOT IN ('REFUNDED', 'FAILED')) AS twice) t
		WHERE (c.deposit_seen_at > now() - interval '7 days' OR c.next_check_at IS NOT NULL)
		  AND (twice OR (c.status = 'FAILED' AND c.created_at > now() - interval '7 days')
		   OR (c.deposit_seen_at IS NOT NULL AND c.status NOT IN ('SUCCESS', 'REFUNDED', 'FAILED')
		       AND c.deadline < now() - $1 * interval '1 second')
		   OR (c.status = 'SUCCESS' AND c.converted_at < now() - $2 * interval '1 second' AND NOT `+invoice.DeliveredSQL+`))
		ORDER BY c.created_at DESC LIMIT 20`, int64(time.Hour/time.Second), int64(UnsettledAfter/time.Second))
	if err != nil {
		return fmt.Errorf("read cross-chain quotes to alert on: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var quote, invoice, status string
		var twice bool
		if err := rows.Scan(&quote, &invoice, &status, &twice); err != nil {
			return err
		}
		message := "ALERT cross-chain deposit unfinished an hour past its deadline"
		switch {
		case twice:
			message = "ALERT two cross-chain quotes of one invoice saw deposits: return the one held to its payer"
		case status == "FAILED":
			message = "ALERT cross-chain swap failed: check 1Click returned the deposit"
		case status == "SUCCESS":
			message = "ALERT cross-chain swap delivered, but no Base deposit with its transaction came in"
		}
		slog.Error(message, "quote", quote, "invoice", invoice, "status", status)
	}
	return rows.Err()
}
