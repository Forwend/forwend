package worker

import (
	"context"
	"fmt"
	"log/slog"
	"time"

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
	// DeadlineSoon: after its settle deadline only the refund authority can move the money, so later ones stop alerting.
	DeadlineSoon = 24 * time.Hour
)

// alert logs an ALERT for symptoms that hold money: a chain whose scan stopped, a deposit that stays detected below
// the finalized block, a receiver's settle or refund the ledger can't book, money owed in full that never becomes
// paid, and paid money not settled in time or close to its settle deadline.
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
	// A user at the daily settlement cap waits by design; only its deadline makes it alert.
	rows, err = w.pool.Query(ctx, `SELECT i.id, i.chain_id, si.status, coalesce(si.reason, ''),
		    extract(epoch FROM now() - si.created_at)::bigint, i.settle_deadline - extract(epoch FROM now())::bigint
		FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id
		WHERE si.status <> 'confirmed' AND i.settle_deadline > extract(epoch FROM now())::bigint
		  AND (si.created_at < now() - $1 * interval '1 second' AND si.wait IS DISTINCT FROM 'cap'
		       OR i.settle_deadline < extract(epoch FROM now())::bigint + $2)
		ORDER BY i.settle_deadline LIMIT 20`, int64(UnsettledAfter/time.Second), int64(DeadlineSoon/time.Second))
	if err != nil {
		return fmt.Errorf("read late settlements: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var invoice, status, reason string
		var chainID, waited, left int64
		if err := rows.Scan(&invoice, &chainID, &status, &reason, &waited, &left); err != nil {
			return err
		}
		message := "ALERT paid invoice not settled"
		if left < int64(DeadlineSoon/time.Second) {
			message = "ALERT paid invoice not settled close to its settle deadline"
		}
		slog.Error(message, "invoice", invoice, "chain", chainID, "intent", status, "reason", reason,
			"waited", time.Duration(waited)*time.Second, "deadlineIn", time.Duration(left)*time.Second)
	}
	return rows.Err()
}
