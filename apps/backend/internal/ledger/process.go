package ledger

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

const BalanceTimeout = 10 * time.Second

// Invoices with a deposit to book go first, so new money is booked even when the round runs out of time (R-120).
// One owed in full but not yet paid waits for the finalized balance check, so it is checked every round.
func (s *Service) ProcessChain(ctx context.Context, chainID uint64) error {
	rows, err := s.pool.Query(ctx, `
  SELECT id FROM (SELECT i.id, i.payment_status, i.closes_at, i.amount, cursor.last_finalized_time,
   EXISTS (SELECT 1 FROM chain_transfers t JOIN invoices option ON option.id=t.invoice_id
    WHERE coalesce(option.main_id,option.id)=coalesce(i.main_id,i.id) AND t.status='detected') AS observed,
   EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = i.id AND t.status = 'confirmed' AND NOT t.booked)
   OR EXISTS (SELECT 1 FROM receiver_outflows o WHERE o.invoice_id = i.id AND o.kind <> 'recovery'
              AND o.ledger_transaction_id IS NULL) AS money
   FROM invoices i JOIN chain_cursors cursor ON cursor.chain_id = i.chain_id WHERE i.chain_id = $1) i
  WHERE money OR (payment_status IN ('open','detected','partially_paid')
   AND (observed OR payment_status = 'detected' OR closes_at < last_finalized_time
    OR payment_status = 'partially_paid' AND (SELECT -coalesce(sum(e.amount), 0) FROM ledger_entries e
     JOIN ledger_transactions t ON t.id = e.transaction_id
     WHERE t.invoice_id = i.id AND e.account = 'recipient_payable') >= amount) AND NOT EXISTS
   (SELECT 1 FROM invoice_balance_alerts a WHERE a.invoice_id = i.id AND a.next_check_at > now()))
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

// Process atomically books one bounded movement prefix; booked movements are never repeated.
func (s *Service) Process(ctx context.Context, invoiceID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("process invoice %s: %w", invoiceID, err)
	}
	defer tx.Rollback(ctx)
	// Options share a winner. Use cancel/reopen's order so different chain jobs cannot lock each other out.
	if _, err := tx.Exec(ctx, `SELECT id FROM invoices
		WHERE coalesce(main_id, id) = (SELECT coalesce(main_id, id) FROM invoices WHERE id = $1)
		ORDER BY main_id IS NULL, id FOR NO KEY UPDATE`, invoiceID); err != nil {
		return fmt.Errorf("lock invoice %s options: %w", invoiceID, err)
	}

	var (
		amountText, current, refund, settlementState, token, receive, factory, group string
		chainID, finalizedBlock                                                      uint64
		closesAt, finalizedTime                                                      int64
		options                                                                      bool
	)
	err = tx.QueryRow(ctx, `
		SELECT i.amount::text, i.payment_status, i.refund_status, i.settlement_status, i.token_contract, i.receive_address,
		       i.factory_address, i.chain_id, i.closes_at, coalesce(c.last_finalized_time, 0),
		       coalesce(c.last_finalized_block, 0),
		       coalesce(i.main_id, i.id), i.main_id IS NOT NULL OR EXISTS (SELECT 1 FROM invoices o WHERE o.main_id = i.id)
		FROM invoices i LEFT JOIN chain_cursors c ON c.chain_id = i.chain_id WHERE i.id = $1 FOR NO KEY UPDATE OF i`,
		invoiceID).Scan(&amountText, &current, &refund, &settlementState, &token, &receive, &factory, &chainID, &closesAt, &finalizedTime,
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
	// Payer chooses (R-56, D-76): the first payment final on its own chain makes its option the invoice's, under the
	// main row's lock so two options can't both win; money on any other option is held for the payer.
	superseded := false
	shown := true // the row invoices_current shows: the chosen option, or the main row until one is chosen
	closedEverywhere := true
	if options {
		var chosen *string
		if err := tx.QueryRow(ctx, "SELECT chosen_id FROM invoices WHERE id = $1 FOR NO KEY UPDATE", group).Scan(&chosen); err != nil {
			return fmt.Errorf("read invoice %s chosen option: %w", group, err)
		}
		if chosen == nil {
			// No other network is waited for: each payment is confirmed on its own network, as hosted crypto checkouts do.
			var first string
			err := tx.QueryRow(ctx, `SELECT t.invoice_id FROM chain_transfers t JOIN invoices i ON i.id = t.invoice_id
				WHERE (i.id = $1 OR i.main_id = $1) AND t.status = 'confirmed' AND t.block_time <= i.closes_at
				ORDER BY t.block_time, t.chain_id, t.block_number, t.log_index LIMIT 1`, group).Scan(&first)
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				var seen bool
				if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_transfers t JOIN invoices i ON i.id = t.invoice_id
     WHERE coalesce(i.main_id,i.id) = $1 AND t.status <> 'reorged' AND t.block_time <= i.closes_at)`, group).Scan(&seen); err != nil {
					return err
				}
				if seen {
					return recordAwaitingChoice(ctx, tx, invoiceID, group, current)
				}
			case err != nil:
				return fmt.Errorf("read invoice %s first paid option: %w", group, err)
			default:
				if _, err := tx.Exec(ctx, "UPDATE invoices SET chosen_id = $2 WHERE id = $1", group, first); err != nil {
					return fmt.Errorf("choose invoice %s option %s: %w", group, first, err)
				}
				if err := history.Add(ctx, tx, group, history.OptionChosen, history.System, history.Data{Option: first}); err != nil {
					return err
				}
				chosen = &first
			}
		}
		if chosen == nil && finalizedTime > closesAt {
			// A payment made before the close may still come on an option chain not final past it.
			if err := tx.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM invoices o
				    JOIN chains c ON c.chain_id = o.chain_id AND c.enabled
				    LEFT JOIN chain_cursors cur ON cur.chain_id = o.chain_id
				    WHERE (o.id = $1 OR o.main_id = $1) AND coalesce(cur.last_finalized_time, 0) <= o.closes_at)`,
				group).Scan(&closedEverywhere); err != nil {
				return fmt.Errorf("read invoice %s option chains past its close: %w", group, err)
			}
		}
		superseded = chosen != nil && *chosen != invoiceID
		shown = chosen == nil && invoiceID == group || chosen != nil && *chosen == invoiceID
	}
	amount, _ := new(big.Int).SetString(amountText, 10)
	owed, err := accountBalance(ctx, tx, invoiceID, "recipient_payable")
	if err != nil {
		return err
	}
	owed.Neg(owed) // credit balances are negative

	if err := attachLegacySettlement(ctx, tx, invoiceID); err != nil {
		return err
	}
	movements, more, err := pendingMovements(ctx, tx, invoiceID)
	if err != nil {
		return err
	}
	depositsBooked := 0
	// A return support queued (PLAN 11.10.3) holds the money until a refund lands.
	returnQueued, refundedNow := refund == "refund_pending", false
	eventExpired := false
	eventClosed := false
	settledNow := false
	final := Final(current) || settlementState == "settled"
	newlyHeld := new(big.Int)        // told to the owner once per run (R-80)
	heldFor := map[string]*big.Int{} // the same by reason, for the history
	hold := func(reason string, value *big.Int) {
		if value.Sign() == 0 {
			return
		}
		if heldFor[reason] == nil {
			heldFor[reason] = new(big.Int)
		}
		heldFor[reason].Add(heldFor[reason], value)
		newlyHeld.Add(newlyHeld, value)
	}
	for _, d := range movements {
		if d.Kind != "deposit" {
			// A movement out after the close settles the close first, so it takes money from the right account.
			if !final && closedEverywhere && d.BlockTime > closesAt && owed.Sign() == 0 {
				final, eventClosed = true, true
			}
			if !final && d.BlockTime > closesAt && owed.Sign() > 0 && owed.Cmp(amount) < 0 {
				if err := book(ctx, tx, invoiceID, "expiry", nil, new(big.Int), new(big.Int).Neg(owed), owed); err != nil {
					return err
				}
				hold(HeldExpired, owed)
				owed.SetInt64(0)
				final, eventExpired = true, true
			}
			booked, err := bookOutflow(ctx, tx, invoiceID, d, amount, shown)
			if err != nil {
				return err
			}
			if !booked {
				break
			}
			if d.Kind == "settlement" {
				final, settledNow = true, true
			}
			if d.Kind == "refund" {
				refundedNow = true
			}
			owed, err = currentPayable(ctx, tx, invoiceID)
			if err != nil {
				return err
			}
			continue
		}
		value, _ := new(big.Int).SetString(d.Amount, 10)
		late := d.BlockTime > closesAt
		toCreator, toHeld := split(amount, owed, value, late, final || superseded)
		if err := book(ctx, tx, invoiceID, "deposit", &d.ID, value, toCreator, toHeld); err != nil {
			return err
		}
		depositsBooked++
		owed.Add(owed, toCreator)
		hold(heldReason(current, late, superseded), toHeld)
	}
	if depositsBooked > 0 { // new money: an unexplained balance may be explained now
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
	case finalizedTime > closesAt && !anyPending && !more && closedEverywhere:
		// Expiry is final, so the ledger must explain the whole balance first: more on chain than booked is a
		// deposit the watcher hasn't booked yet (a missed log).
		if mayExpire, err = s.balanced(ctx, tx, invoiceID, chainID, finalizedBlock, token, receive); err != nil {
			return err
		}
	}
	next := status(current, amount, owed, anyTransfer, mayExpire, funded)
	if settledNow && !Final(current) { // the receiver paid the full amount to the recipient
		next = Paid
	}
	if eventExpired {
		next = ExpiredPartiallyPaid
	}
	if eventClosed {
		next = Expired
	}
	if current == PartiallyPaid && next == Detected {
		next = PartiallyPaid
	}
	if next == ExpiredPartiallyPaid && current != ExpiredPartiallyPaid {
		// Held for the payer (D-26): what was owed to the creator is theirs again only if the owner reopens (R-130).
		if !eventExpired {
			if err := book(ctx, tx, invoiceID, "expiry", nil, new(big.Int), new(big.Int).Neg(owed), owed); err != nil {
				return err
			}
			hold(HeldExpired, owed)
		}
		// A reopen must end before the receiver's settle window does (R-130).
		readCtx, cancel := context.WithTimeout(ctx, BalanceTimeout)
		deployedAt, err := s.deployed(readCtx, chainID, factory, receive)
		cancel()
		if err != nil {
			return fmt.Errorf("check invoice %s receiver: %w", invoiceID, err)
		}
		if _, err := tx.Exec(ctx, "UPDATE invoices SET receiver_deployed_at = $2 WHERE id = $1 AND receiver_deployed_at IS NULL",
			invoiceID, int64(deployedAt)); err != nil {
			return fmt.Errorf("record invoice %s receiver deploy time: %w", invoiceID, err)
		}
	}
	held, err := accountBalance(ctx, tx, invoiceID, "payer_held")
	if err != nil {
		return err
	}
	if held.Sign() != 0 {
		refund = "held"
		if returnQueued && !refundedNow {
			refund = "refund_pending"
		}
	} else {
		var returned bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = $1
   AND kind = 'refund' AND ledger_transaction_id IS NOT NULL)`, invoiceID).Scan(&returned); err != nil {
			return err
		}
		if returned {
			refund = "refunded"
		} else {
			refund = "none"
		}
	}
	if _, err := tx.Exec(ctx, "UPDATE invoices SET payment_status = $2, refund_status = $3 WHERE id = $1",
		invoiceID, next, refund); err != nil {
		return fmt.Errorf("update invoice %s status: %w", invoiceID, err)
	}
	// Only the shown row's status is history: an option not chosen doesn't change the invoice's status.
	if shown && next != current {
		if err := history.Add(ctx, tx, invoiceID, "invoice."+next, history.System, history.Data{}); err != nil {
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
		netHeld := new(big.Int).Neg(held)
		notice := minInt(newlyHeld, netHeld)
		if notice.Sign() > 0 {
			if err := outbox.Queue(ctx, tx, outbox.Held, invoiceID, notice); err != nil {
				return err
			}
		}
		for _, reason := range heldReasons {
			if heldFor[reason] == nil {
				continue
			}
			event := history.Data{Amount: heldFor[reason].String(), Reason: reason}
			if options {
				event.Option = invoiceID
			}
			if err := history.Add(ctx, tx, invoiceID, history.Held, history.System, event); err != nil {
				return err
			}
		}
	}
	var settled bool
	if err := tx.QueryRow(ctx, "SELECT settlement_status = 'settled' FROM invoices WHERE id = $1", invoiceID).Scan(&settled); err != nil {
		return err
	}
	if next == Paid && current != Paid && !settled {
		// The signer settles it; one intent per invoice (R-22).
		if _, err := tx.Exec(ctx, `WITH i AS (INSERT INTO settlement_intents (invoice_id) VALUES ($1) ON CONFLICT DO NOTHING)
			UPDATE invoices SET settlement_status = 'pending' WHERE id = $1`, invoiceID); err != nil {
			return fmt.Errorf("queue invoice %s settlement: %w", invoiceID, err)
		}
		if err := history.Add(ctx, tx, invoiceID, history.SettlementQueued, history.System, history.Data{}); err != nil {
			return err
		}
	}
	if depositsBooked > 0 {
		// A payment-link invoice takes the profile's next number with its first booked deposit (D-50, R-141). Last,
		// so the profile row isn't locked while the selected RPC is read.
		tag, err := tx.Exec(ctx, `WITH n AS (UPDATE profiles p SET invoice_seq = invoice_seq + 1 FROM invoices m
			    WHERE m.id = $1 AND m.number IS NULL AND m.document_kind <> 'none' AND p.id = m.profile_id RETURNING p.invoice_seq)
			UPDATE invoices i SET number = n.invoice_seq FROM n WHERE coalesce(i.main_id, i.id) = $1`, group)
		if err != nil {
			return fmt.Errorf("number invoice %s: %w", group, err)
		}
		if tag.RowsAffected() > 0 {
			if err := history.Add(ctx, tx, group, history.Numbered, history.System, history.Data{}); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

// funded asks the selected RPC whether the receive address holds at least every booked deposit (D-15).
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

// balanced asks the selected RPC whether the receive address holds exactly what is booked.
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
		// A deposit the watcher never saw: an operator refunds it (money-safety.md).
		slog.Error("ALERT receive address holds money with no booked transfer; not expiring", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String())
		return false, alertAgainLater(ctx, tx, invoiceID)
	}
	if onChain.Cmp(booked) < 0 {
		slog.Error("ALERT receive address holds less than booked; not expiring", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String())
		return false, alertAgainLater(ctx, tx, invoiceID)
	}
	return true, nil
}

// Backs off 1 min, doubling to at most a day, so unexplained balances can't use up the round's RPC calls (R-120).
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

// onChain is nil when the RPC snapshot is behind the watcher's finalized block: nothing is decided until it catches up.
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
		slog.Warn("RPC snapshot is behind the finalized block; deciding later", "invoice", invoiceID,
			"rpcBlock", block, "finalized", finalized)
		return booked, nil, nil
	}
	return booked, onChain, nil
}
