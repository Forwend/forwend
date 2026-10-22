package ledger

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

// BalanceTimeout bounds one second-RPC balance call.
const BalanceTimeout = 10 * time.Second

// ProcessChain runs Process for every invoice on the chain that can still change: not final yet and not waiting after
// an unexplained balance (R-120), or with a confirmed deposit not booked yet. Those with a deposit to book go first,
// so new money is booked even when the round runs out of time. ponytail: scans every open invoice each run; index by
// due work if it grows.
func (s *Service) ProcessChain(ctx context.Context, chainID uint64) error {
	rows, err := s.pool.Query(ctx, `
		SELECT id FROM (SELECT i.id, i.payment_status, EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = i.id
		        AND t.status = 'confirmed' AND NOT t.booked) AS money
		    FROM invoices i WHERE i.chain_id = $1) i
		WHERE money OR (payment_status IN ('open', 'detected', 'partially_paid')
		    AND NOT EXISTS (SELECT 1 FROM invoice_balance_alerts a WHERE a.invoice_id = i.id AND a.next_check_at > now()))
		ORDER BY money DESC`, chainID)
	if err != nil {
		return fmt.Errorf("list chain %d invoices to process: %w", chainID, err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("list chain %d invoices to process: %w", chainID, err)
	}
	var errs []error // one invoice's failure must not stop the others
	for _, id := range ids {
		if err := s.Process(ctx, id); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// Process books the invoice's confirmed deposits in chain order, then sets its payment status, in one transaction
// with the invoice row locked. Running it again changes nothing.
func (s *Service) Process(ctx context.Context, invoiceID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("process invoice %s: %w", invoiceID, err)
	}
	defer tx.Rollback(ctx)

	var (
		amountText, current, refund, token, receive, group string
		chainID, finalizedBlock                            uint64
		expiresAt, finalizedTime                           int64
		options                                            bool
	)
	err = tx.QueryRow(ctx, `
		SELECT i.amount::text, i.payment_status, i.refund_status, i.token_contract, i.receive_address, i.chain_id,
		       i.expires_at, coalesce(c.last_finalized_time, 0), coalesce(c.last_finalized_block, 0),
		       coalesce(i.main_id, i.id), i.main_id IS NOT NULL OR EXISTS (SELECT 1 FROM invoices o WHERE o.main_id = i.id)
		FROM invoices i LEFT JOIN chain_cursors c ON c.chain_id = i.chain_id WHERE i.id = $1 FOR UPDATE OF i`,
		invoiceID).Scan(&amountText, &current, &refund, &token, &receive, &chainID, &expiresAt, &finalizedTime,
		&finalizedBlock, &group, &options)
	if err != nil {
		return fmt.Errorf("read invoice %s: %w", invoiceID, err)
	}

	var anyTransfer, anyPending bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_transfers WHERE invoice_id = $1 AND status <> 'reorged'),
		EXISTS (SELECT 1 FROM chain_transfers WHERE invoice_id = $1 AND status = 'detected')`,
		invoiceID).Scan(&anyTransfer, &anyPending); err != nil {
		return fmt.Errorf("read invoice %s transfers: %w", invoiceID, err)
	}
	// Payer chooses (R-56, D-76): the option whose money came first on chain becomes the invoice's, under the main
	// row's lock so two options can't both win; money on any other option is held for the payer.
	superseded := false
	if options {
		var chosen *string
		if err := tx.QueryRow(ctx, "SELECT chosen_id FROM invoices WHERE id = $1 FOR UPDATE", group).Scan(&chosen); err != nil {
			return fmt.Errorf("read invoice %s chosen option: %w", group, err)
		}
		if chosen == nil && anyTransfer {
			// Chains are read one after another, so an earlier transfer may still come on a chain not read that far:
			// the first one counts only once every other enabled option chain was read past its time (R-119), about
			// one round later. Its own chain was read up to it. Until then nothing of the invoice is chosen or booked.
			var first string
			var ready bool
			if err := tx.QueryRow(ctx, `SELECT t.invoice_id, NOT EXISTS (SELECT 1 FROM invoices o
				    JOIN chains c ON c.chain_id = o.chain_id AND c.enabled
				    LEFT JOIN chain_cursors cur ON cur.chain_id = o.chain_id
				    WHERE coalesce(o.main_id, o.id) = $1 AND o.chain_id <> t.chain_id
				      AND coalesce(cur.last_scanned_time, 0) <= t.block_time)
				FROM chain_transfers t JOIN invoices i ON i.id = t.invoice_id
				WHERE coalesce(i.main_id, i.id) = $1 AND t.status <> 'reorged'
				ORDER BY t.block_time, t.chain_id, t.block_number, t.log_index LIMIT 1`, group).Scan(&first, &ready); err != nil {
				return fmt.Errorf("read invoice %s first paid option: %w", group, err)
			}
			if !ready {
				return nil
			}
			if _, err := tx.Exec(ctx, "UPDATE invoices SET chosen_id = $2 WHERE id = $1", group, first); err != nil {
				return fmt.Errorf("choose invoice %s option %s: %w", group, first, err)
			}
			if err := history.Add(ctx, tx, group, history.OptionChosen, history.System, history.Data{Option: first}); err != nil {
				return err
			}
			chosen = &first
		}
		superseded = chosen != nil && *chosen != invoiceID
	}
	amount, _ := new(big.Int).SetString(amountText, 10)
	owed, err := accountBalance(ctx, tx, invoiceID, "recipient_payable")
	if err != nil {
		return err
	}
	owed.Neg(owed) // credit balances are negative

	// In chain order: a deposit waits while an earlier one is still detected, so the earliest payers are paid to the
	// creator first and later ones held for refund (D-27).
	rows, err := tx.Query(ctx, `
		SELECT id, amount::text, block_time FROM chain_transfers t
		WHERE invoice_id = $1 AND status = 'confirmed' AND NOT booked
		  AND NOT EXISTS (SELECT 1 FROM chain_transfers d WHERE d.invoice_id = t.invoice_id AND d.status = 'detected'
		                  AND (d.block_number, d.log_index) < (t.block_number, t.log_index))
		ORDER BY block_number, log_index`, invoiceID)
	if err != nil {
		return fmt.Errorf("read invoice %s deposits: %w", invoiceID, err)
	}
	type confirmed struct { // exported fields: pgx fills them by position
		ID        int64
		Amount    string
		BlockTime int64
	}
	deposits, err := pgx.CollectRows(rows, pgx.RowToStructByPos[confirmed])
	if err != nil {
		return fmt.Errorf("read invoice %s deposits: %w", invoiceID, err)
	}
	final := Final(current)
	newlyHeld := new(big.Int) // told to the owner once per run (R-80)
	for _, d := range deposits {
		value, _ := new(big.Int).SetString(d.Amount, 10)
		toCreator, toHeld := split(amount, owed, value, d.BlockTime > expiresAt, final || superseded)
		if err := book(ctx, tx, invoiceID, "deposit", &d.ID, value, toCreator, toHeld); err != nil {
			return err
		}
		owed.Add(owed, toCreator)
		newlyHeld.Add(newlyHeld, toHeld)
	}
	if len(deposits) > 0 { // new money: an unexplained balance may be explained now
		if _, err := tx.Exec(ctx, "DELETE FROM invoice_balance_alerts WHERE invoice_id = $1", invoiceID); err != nil {
			return fmt.Errorf("clear invoice %s balance alert: %w", invoiceID, err)
		}
	}

	funded, mayExpire := false, false
	switch {
	case final:
	case owed.Cmp(amount) >= 0:
		if funded, err = s.funded(ctx, tx, invoiceID, chainID, finalizedBlock, token, receive); err != nil {
			return err
		}
	case finalizedTime > expiresAt && !anyPending:
		// Expiry is final, so the ledger must explain the whole balance first: more on chain than booked is a
		// deposit the watcher hasn't booked yet (a missed log, an Arc native-coin payment).
		if mayExpire, err = s.balanced(ctx, tx, invoiceID, chainID, finalizedBlock, token, receive); err != nil {
			return err
		}
	}
	next := status(current, amount, owed, anyTransfer, mayExpire, funded)
	if next == ExpiredPartiallyPaid && current != ExpiredPartiallyPaid {
		// Never settled to the creator (D-26): what was owed to them is now held for the payer.
		if err := book(ctx, tx, invoiceID, "expiry", nil, new(big.Int), new(big.Int).Neg(owed), owed); err != nil {
			return err
		}
		newlyHeld.Add(newlyHeld, owed)
	}
	held, err := accountBalance(ctx, tx, invoiceID, "payer_held")
	if err != nil {
		return err
	}
	if held.Sign() != 0 && refund == "none" {
		refund = "held"
	}
	if _, err := tx.Exec(ctx, "UPDATE invoices SET payment_status = $2, refund_status = $3 WHERE id = $1",
		invoiceID, next, refund); err != nil {
		return fmt.Errorf("update invoice %s status: %w", invoiceID, err)
	}
	var on history.Data // which option changed, when the invoice has several
	if options {
		on.Option = invoiceID
	}
	if next != current {
		if err := history.Add(ctx, tx, invoiceID, "invoice."+next, history.System, on); err != nil {
			return err
		}
	}
	// Paid before held: the owner reads that it was paid, then that the extra is the payer's.
	if next == Paid && current != Paid {
		if err := outbox.Queue(ctx, tx, outbox.Paid, invoiceID, nil); err != nil {
			return err
		}
		if err := outbox.QueueReceipt(ctx, tx, invoiceID); err != nil {
			return err
		}
	}
	if newlyHeld.Sign() > 0 {
		if err := outbox.Queue(ctx, tx, outbox.Held, invoiceID, newlyHeld); err != nil {
			return err
		}
		held := on
		held.Amount = newlyHeld.String()
		if err := history.Add(ctx, tx, invoiceID, history.Held, history.System, held); err != nil {
			return err
		}
	}
	if next == Paid && current != Paid {
		// The signer settles it; one intent per invoice (R-22).
		if _, err := tx.Exec(ctx, `WITH i AS (INSERT INTO settlement_intents (invoice_id) VALUES ($1) ON CONFLICT DO NOTHING)
			UPDATE invoices SET settlement_status = 'pending' WHERE id = $1`, invoiceID); err != nil {
			return fmt.Errorf("queue invoice %s settlement: %w", invoiceID, err)
		}
		if err := history.Add(ctx, tx, invoiceID, history.SettlementQueued, history.System, on); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// funded asks the second RPC whether the receive address holds at least every booked deposit (D-15).
func (s *Service) funded(ctx context.Context, tx pgx.Tx, invoiceID string, chainID, finalized uint64, token, receive string) (bool, error) {
	booked, onChain, err := s.compare(ctx, tx, invoiceID, chainID, finalized, token, receive)
	if err != nil || onChain == nil {
		return false, err
	}
	if onChain.Cmp(booked) < 0 {
		slog.Warn("receive address holds less than booked; not paid", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String())
		return false, nil
	}
	return true, nil
}

// balanced asks the second RPC whether the receive address holds exactly what is booked.
func (s *Service) balanced(ctx context.Context, tx pgx.Tx, invoiceID string, chainID, finalized uint64, token, receive string) (bool, error) {
	var waiting bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM invoice_balance_alerts WHERE invoice_id = $1
		AND next_check_at > now())`, invoiceID).Scan(&waiting); err != nil || waiting {
		return false, err
	}
	booked, onChain, err := s.compare(ctx, tx, invoiceID, chainID, finalized, token, receive)
	if err != nil || onChain == nil {
		return false, err
	}
	if onChain.Cmp(booked) > 0 {
		// A deposit the watcher never saw, or Arc USDC sent natively: an operator books it (money-safety.md).
		slog.Error("ALERT receive address holds money with no booked transfer; not expiring", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String())
		return false, alertAgainLater(ctx, tx, invoiceID)
	}
	if onChain.Cmp(booked) < 0 {
		slog.Warn("receive address holds less than booked; not expiring", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String())
		return false, alertAgainLater(ctx, tx, invoiceID)
	}
	return true, nil
}

// alertAgainLater counts one more unexplained balance and sets when the worker reads it again: 1 min, doubling to at
// most a day (R-120). Each read costs second-RPC calls in the chain's round, so many such invoices can't use it up.
// The exponent stops at 11 (34 h, over the cap): a larger one overflows Postgres's interval.
func alertAgainLater(ctx context.Context, tx pgx.Tx, invoiceID string) error {
	if _, err := tx.Exec(ctx, `INSERT INTO invoice_balance_alerts (invoice_id, alerts, next_check_at)
		VALUES ($1, 1, now() + interval '1 minute')
		ON CONFLICT (invoice_id) DO UPDATE SET alerts = invoice_balance_alerts.alerts + 1,
		    next_check_at = now() + least(interval '1 minute' * power(2, least(invoice_balance_alerts.alerts, 11)),
		        interval '1 day')`,
		invoiceID); err != nil {
		return fmt.Errorf("record invoice %s balance alert: %w", invoiceID, err)
	}
	return nil
}

// compare returns the booked receiver balance and the second RPC's balance. onChain is nil when that RPC is behind
// the watcher's finalized block: it may not see final deposits yet, so nothing is decided until it catches up.
// ponytail: the RPC call runs inside the transaction holding the invoice lock, bounded by BalanceTimeout.
func (s *Service) compare(ctx context.Context, tx pgx.Tx, invoiceID string, chainID, finalized uint64, token, receive string) (booked, onChain *big.Int, err error) {
	if booked, err = accountBalance(ctx, tx, invoiceID, "receiver"); err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, BalanceTimeout)
	defer cancel()
	onChain, block, err := s.balance(ctx, chainID, token, receive)
	if err != nil {
		return nil, nil, fmt.Errorf("check invoice %s balance: %w", invoiceID, err)
	}
	if block < finalized {
		slog.Warn("second RPC is behind the finalized block; deciding later", "invoice", invoiceID,
			"rpcBlock", block, "finalized", finalized)
		return booked, nil, nil
	}
	return booked, onChain, nil
}
