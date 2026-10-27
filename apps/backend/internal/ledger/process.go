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
func (s *Service) ProcessChain(ctx context.Context, chainID uint64) error {
	return s.processChain(ctx, chainID, true)
}

func (s *Service) processChain(ctx context.Context, chainID uint64, requireCoverage bool) error {
	rows, err := s.pool.Query(ctx, `
  SELECT id, certified FROM (SELECT i.id, i.payment_status, i.closes_at, cursor.last_finalized_time,
   EXISTS (SELECT 1 FROM chain_transfers t JOIN invoices option ON option.id=t.invoice_id
    WHERE coalesce(option.main_id,option.id)=coalesce(i.main_id,i.id) AND t.status='detected') AS observed,
   EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = i.id AND t.status = 'confirmed' AND NOT t.booked)
   OR EXISTS (SELECT 1 FROM receiver_outflows o WHERE o.invoice_id = i.id AND o.kind <> 'recovery'
              AND o.ledger_transaction_id IS NULL) AS money,
   NOT $2 OR coalesce(scan.opening_checked AND scan.reconciliation_error IS NULL AND scan.booking_error IS NULL
    AND scan.scanned_block >= cursor.last_finalized_block AND NOT EXISTS (
     SELECT 1 FROM chain_transfers d WHERE d.invoice_id = i.id AND d.status = 'confirmed'
     AND NOT EXISTS (SELECT 1 FROM receiver_deposit_proofs p WHERE p.chain_transfer_id = d.id)),false) AS certified
   FROM invoices i JOIN receiver_scans scan ON scan.invoice_id = i.id
   JOIN chain_cursors cursor ON cursor.chain_id = i.chain_id WHERE i.chain_id = $1) i
  WHERE money OR (payment_status IN ('open','detected','partially_paid')
   AND (observed OR payment_status = 'detected' OR closes_at < last_finalized_time) AND NOT EXISTS
   (SELECT 1 FROM invoice_balance_alerts a WHERE a.invoice_id = i.id AND a.next_check_at > now()))
  ORDER BY money DESC`, chainID, requireCoverage)
	if err != nil {
		return fmt.Errorf("list chain %d invoices to process: %w", chainID, err)
	}
	type work struct {
		ID        string
		Certified bool
	}
	ids, err := pgx.CollectRows(rows, pgx.RowToStructByPos[work])
	if err != nil {
		return fmt.Errorf("list chain %d invoices to process: %w", chainID, err)
	}
	var errs []error // one invoice's failure must not stop the others
	for _, item := range ids {
		var err error
		if item.Certified {
			err = s.Process(ctx, item.ID)
		} else {
			err = s.observe(ctx, item.ID)
		}
		if err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// Process runs in one transaction with the invoice row locked; running it again changes nothing.
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

	var identityConflict bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM receiver_conflicts WHERE invoice_id = $1) OR EXISTS (SELECT 1 FROM receiver_scans WHERE invoice_id = $1 AND booking_error IS NOT NULL)", invoiceID).Scan(&identityConflict); err != nil {
		return err
	}
	if identityConflict {
		return tx.Commit(ctx)
	}
	var negative bool
	if err := tx.QueryRow(ctx, "SELECT "+negativeBalancesSQL("$1"), invoiceID).Scan(&negative); err != nil {
		return err
	}
	if negative {
		if _, err := tx.Exec(ctx, "UPDATE receiver_scans SET booking_error = 'negative_legacy_balance' WHERE invoice_id = $1", invoiceID); err != nil {
			return err
		}
		return tx.Commit(ctx)
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
	shown := true // the row invoices_current shows: the chosen option, or the main row until one is chosen
	closedEverywhere := true
	if options {
		var chosen *string
		if err := tx.QueryRow(ctx, "SELECT chosen_id FROM invoices WHERE id = $1 FOR NO KEY UPDATE", group).Scan(&chosen); err != nil {
			return fmt.Errorf("read invoice %s chosen option: %w", group, err)
		}
		if chosen == nil {
			// Global chain progress does not prove historical coverage for each competing receiver (R-119).
			var first string
			var ready bool
			err := tx.QueryRow(ctx, `SELECT t.invoice_id, NOT EXISTS (SELECT 1 FROM invoices o
				    JOIN chains c ON c.chain_id = o.chain_id AND c.enabled
				    LEFT JOIN receiver_scans scan ON scan.invoice_id = o.id
       WHERE (o.id = $1 OR o.main_id = $1)
       AND (NOT coalesce(scan.opening_checked, false) OR scan.reconciliation_error IS NOT NULL OR scan.booking_error IS NOT NULL
            OR CASE WHEN o.chain_id = t.chain_id THEN (coalesce(scan.scanned_block,-1) < t.block_number OR coalesce(scan.block_time,0) < t.block_time)
                    ELSE coalesce(scan.block_time,0) <= t.block_time END))
				FROM chain_transfers t JOIN invoices i ON i.id = t.invoice_id
				WHERE (i.id = $1 OR i.main_id = $1) AND t.status = 'confirmed' AND t.block_time <= i.closes_at
      AND EXISTS (SELECT 1 FROM receiver_deposit_proofs p WHERE p.chain_transfer_id = t.id)
    ORDER BY t.block_time, t.chain_id, t.block_number, t.log_index LIMIT 1`, group).Scan(&first, &ready)
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
			case !ready:
				return recordAwaitingChoice(ctx, tx, invoiceID, group, current)
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
		if chosen != nil {
			var conflict bool
			if err := tx.QueryRow(ctx, `WITH evidence AS (
              SELECT d.invoice_id,d.block_time,d.chain_id,d.block_number,d.log_index FROM chain_transfers d
              JOIN invoices i ON i.id = d.invoice_id JOIN receiver_deposit_proofs p ON p.chain_transfer_id = d.id
              WHERE coalesce(i.main_id,i.id) = $1 AND d.status = 'confirmed' AND d.block_time <= i.closes_at
            ), first_chosen AS (SELECT * FROM evidence WHERE invoice_id = $2 ORDER BY block_time,chain_id,block_number,log_index LIMIT 1)
            SELECT EXISTS (SELECT 1 FROM evidence e CROSS JOIN first_chosen c WHERE e.invoice_id <> c.invoice_id
              AND (e.block_time,e.chain_id,e.block_number,e.log_index) < (c.block_time,c.chain_id,c.block_number,c.log_index))`, group, *chosen).Scan(&conflict); err != nil {
				return err
			}
			if conflict {
				if _, err := tx.Exec(ctx, `UPDATE receiver_scans s SET booking_error = 'legacy_option_choice' FROM invoices i
                  WHERE i.id = s.invoice_id AND coalesce(i.main_id,i.id) = $1`, group); err != nil {
					return err
				}
				return tx.Commit(ctx)
			}
		}
		if chosen == nil && finalizedTime > closesAt {
			// A payment made before the close may still come on an option chain not read past it.
			if err := tx.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM invoices o
				    JOIN chains c ON c.chain_id = o.chain_id AND c.enabled
				    LEFT JOIN receiver_scans scan ON scan.invoice_id = o.id
       WHERE (o.id = $1 OR o.main_id = $1)
       AND (NOT coalesce(scan.opening_checked,false) OR scan.reconciliation_error IS NOT NULL OR scan.booking_error IS NOT NULL
            OR coalesce(scan.block_time,0) <= o.closes_at))`, group).Scan(&closedEverywhere); err != nil {
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
	movements, err := pendingMovements(ctx, tx, invoiceID)
	if err != nil {
		return err
	}
	depositsBooked := 0
	paidRecorded := false
	eventExpired := false
	eventClosed := false
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
			ready, err := receiverEvidence(ctx, tx, invoiceID, d.BlockNumber)
			if err != nil {
				return err
			}
			if ready && !final && closedEverywhere && d.BlockTime > closesAt && owed.Sign() == 0 {
				final, eventClosed = true, true
			}
			if ready && !final && d.BlockTime > closesAt && owed.Sign() > 0 && owed.Cmp(amount) < 0 {
				if err := book(ctx, tx, invoiceID, "expiry", nil, new(big.Int), new(big.Int).Neg(owed), owed); err != nil {
					return err
				}
				hold(HeldExpired, owed)
				owed.SetInt64(0)
				final, eventExpired = true, true
			}
			if proved, err := captureFunding(ctx, tx, invoiceID, d, amount); err != nil {
				return err
			} else if proved && current != Paid && !paidRecorded {
				if err := recordHistoricalPaid(ctx, tx, invoiceID, shown); err != nil {
					return err
				}
				paidRecorded = true
				final = true
			}
			booked, err := bookOutflow(ctx, tx, invoiceID, d, amount, shown)
			if err != nil {
				return err
			}
			if !booked {
				break
			}
			if d.Kind == "settlement" {
				final = true
			}
			owed, err = currentPayable(ctx, tx, invoiceID)
			if err != nil {
				return err
			}
			continue
		}
		var future bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_transfers WHERE invoice_id = $1 AND booked
   AND (block_number, log_index) > ($2,$3))`, invoiceID, d.BlockNumber, d.LogIndex).Scan(&future); err != nil {
			return err
		}
		if future {
			if _, err := tx.Exec(ctx, "UPDATE receiver_scans SET booking_error = 'historical_deposit_order' WHERE invoice_id = $1", invoiceID); err != nil {
				return err
			}
			break
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
		after := d
		after.LogIndex++
		if proved, err := captureFunding(ctx, tx, invoiceID, after, amount); err != nil {
			return err
		} else if proved {
			final = true
			if current != Paid && !paidRecorded {
				if err := recordHistoricalPaid(ctx, tx, invoiceID, shown); err != nil {
					return err
				}
				paidRecorded = true
			}
		}
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
	case finalizedTime > closesAt && !anyPending && closedEverywhere:
		// Expiry is final, so the ledger must explain the whole balance first: more on chain than booked is a
		// deposit the watcher hasn't booked yet (a missed log, an Arc native-coin payment).
		if mayExpire, err = s.balanced(ctx, tx, invoiceID, chainID, finalizedBlock, token, receive); err != nil {
			return err
		}
	}
	historicalFunding, err := hasFunding(ctx, tx, invoiceID)
	if err != nil {
		return err
	}
	next := status(current, amount, owed, anyTransfer, mayExpire, funded)
	if historicalFunding && current != Canceled && current != Expired && current != ExpiredPartiallyPaid {
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
	if shown && next != current && !(next == Paid && paidRecorded) {
		if err := history.Add(ctx, tx, invoiceID, "invoice."+next, history.System, history.Data{}); err != nil {
			return err
		}
	}
	// Paid before held: the owner reads that it was paid, then that the extra is the payer's.
	if next == Paid && current != Paid && !paidRecorded {
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
		// so the profile row isn't locked while the second RPC is read.
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

// onChain is nil when the second RPC is behind the watcher's finalized block: nothing is decided until it catches up.
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
