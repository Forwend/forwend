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

// Invoices with a deposit to book go first, so new money is booked even when the round runs out of time.
func (s *Service) ProcessChain(ctx context.Context, chainID uint64) error {
	rows, err := s.pool.Query(ctx, `
  SELECT id FROM (SELECT i.id, i.payment_status, i.closes_at, i.amount, cursor.last_finalized_time,
   EXISTS (SELECT 1 FROM chain_transfers t JOIN invoices option ON option.id=t.invoice_id
    WHERE coalesce(option.main_id,option.id)=coalesce(i.main_id,i.id) AND t.status='detected') AS observed,
   EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = i.id AND t.status = 'confirmed' AND NOT t.booked)
   OR EXISTS (SELECT 1 FROM receiver_outflows o WHERE o.invoice_id = i.id AND o.kind <> 'recovery'
              AND o.ledger_transaction_id IS NULL) AS money
   FROM invoices i JOIN chain_cursors cursor ON cursor.chain_id = i.chain_id WHERE i.chain_id = $1
    -- Only open invoices and ones with money to book can match: read them from their small partial indexes.
    AND i.id IN (SELECT id FROM invoices WHERE chain_id = $1 AND payment_status IN ('open','detected','partially_paid')
     UNION SELECT invoice_id FROM chain_transfers WHERE status = 'confirmed' AND NOT booked
     UNION SELECT invoice_id FROM receiver_outflows WHERE kind <> 'recovery' AND ledger_transaction_id IS NULL)) i
  WHERE money OR (payment_status IN ('open','detected','partially_paid')
   AND (observed OR payment_status = 'detected' OR closes_at < last_finalized_time
    OR payment_status = 'partially_paid' AND `+OwedSQL("i.id")+` >= amount) AND NOT EXISTS
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
	choice := optionChoice{shown: true, closedEverywhere: true}
	if options {
		var waiting bool
		if choice, waiting, err = chooseOption(ctx, tx, invoiceID, group, current, refund, settlementState, closesAt,
			finalizedTime); err != nil {
			return err
		}
		if waiting {
			return recordAwaitingChoice(ctx, tx, invoiceID, group, current)
		}
	}
	amount, _ := new(big.Int).SetString(amountText, 10)
	owed, err := currentPayable(ctx, tx, invoiceID)
	if err != nil {
		return err
	}

	if err := attachLegacySettlement(ctx, tx, invoiceID); err != nil {
		return err
	}
	movements, more, err := pendingMovements(ctx, tx, invoiceID)
	if err != nil {
		return err
	}
	if choice.applyEarlier {
		moved, err := applyHeldParts(ctx, tx, invoiceID, closesAt, new(big.Int).Sub(amount, owed))
		if err != nil {
			return err
		}
		owed.Add(owed, moved)
	}
	depositsBooked := 0
	// A return support queued holds the money until a refund lands.
	returnQueued, refundedNow := refund == "refund_pending", false
	eventExpired := false
	eventClosed := false
	settledNow := false
	final := Final(current) || settlementState == "settled"
	newlyHeld := new(big.Int)        // told to the owner once per run
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
	// Dust a stranger can send (on-time money under the least amount) is held without a word to the owner.
	least, onTime := new(big.Int), new(big.Int)
	if options {
		var leastText, bookedText string
		if err := tx.QueryRow(ctx, `SELECT `+leastAmount+`::text, coalesce((SELECT sum(t.amount) FROM chain_transfers t
			    WHERE t.invoice_id = i.id AND t.booked AND t.status = 'confirmed' AND t.block_time <= i.closes_at), 0)::text
			FROM invoices i JOIN tokens tk ON tk.chain_id = i.chain_id AND tk.contract = i.token_contract WHERE i.id = $1`,
			invoiceID).Scan(&leastText, &bookedText); err != nil {
			return fmt.Errorf("read invoice %s least amount: %w", invoiceID, err)
		}
		least.SetString(leastText, 10)
		onTime.SetString(bookedText, 10)
	}
	for _, d := range movements {
		if d.Kind != "deposit" {
			// A movement out after the close settles the close first, so it takes money from the right account.
			if !final && choice.closedEverywhere && d.BlockTime > closesAt && owed.Sign() == 0 {
				final, eventClosed = true, true
			}
			if !final && d.BlockTime > closesAt && owed.Sign() > 0 && owed.Cmp(amount) < 0 {
				if _, err := book(ctx, tx, invoiceID, "expiry", nil, new(big.Int), new(big.Int).Neg(owed), owed); err != nil {
					return err
				}
				hold(HeldExpired, owed)
				owed.SetInt64(0)
				final, eventExpired = true, true
			}
			booked, err := bookOutflow(ctx, tx, invoiceID, d, amount, choice.shown)
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
		// While no option is chosen a payment is the payer's; applyHeldParts gives it to the creator once its option is.
		toCreator, toHeld := split(amount, owed, value, late, final || choice.superseded || choice.noneChosen)
		if _, err := book(ctx, tx, invoiceID, "deposit", &d.ID, value, toCreator, toHeld); err != nil {
			return err
		}
		depositsBooked++
		owed.Add(owed, toCreator)
		if !late {
			onTime.Add(onTime, value)
		}
		if dust := options && !late && !final && onTime.Cmp(least) < 0; !dust {
			hold(heldReason(current, late, choice.superseded), toHeld)
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
	case finalizedTime > closesAt && !anyPending && !more && choice.closedEverywhere:
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
	// Money that chose no option is held, so it never makes the invoice confirming or partly paid.
	if choice.noneChosen && next == Detected {
		next = Open
	}
	if next == ExpiredPartiallyPaid && current != ExpiredPartiallyPaid {
		// Held for the payer: what was owed to the creator is theirs again only if the owner reopens.
		if !eventExpired {
			if _, err := book(ctx, tx, invoiceID, "expiry", nil, new(big.Int), new(big.Int).Neg(owed), owed); err != nil {
				return err
			}
			hold(HeldExpired, owed)
		}
		// A reopen must end before the receiver's settle window does.
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
	if _, err := tx.Exec(ctx, `UPDATE invoices SET payment_status = $2, refund_status = $3
		WHERE id = $1 AND (payment_status, refund_status) IS DISTINCT FROM ($2, $3)`,
		invoiceID, next, refund); err != nil {
		return fmt.Errorf("update invoice %s status: %w", invoiceID, err)
	}
	// Only the shown row's status is history: an option not chosen doesn't change the invoice's status.
	if choice.shown && next != current {
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
		// The signer settles it; one intent per invoice.
		if _, err := tx.Exec(ctx, `WITH i AS (INSERT INTO settlement_intents (invoice_id) VALUES ($1) ON CONFLICT DO NOTHING)
			UPDATE invoices SET settlement_status = 'pending' WHERE id = $1`, invoiceID); err != nil {
			return fmt.Errorf("queue invoice %s settlement: %w", invoiceID, err)
		}
		if err := history.Add(ctx, tx, invoiceID, history.SettlementQueued, history.System, history.Data{}); err != nil {
			return err
		}
	}
	if depositsBooked > 0 {
		// A link invoice takes the profile's next number with its first booked deposit; last, so the profile row isn't
		// locked while the RPC is read.
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
