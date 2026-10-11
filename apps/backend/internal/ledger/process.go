package ledger

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
)

// BalanceTimeout bounds one second-RPC balance call.
const BalanceTimeout = 10 * time.Second

// ProcessChain runs Process for every invoice on the chain that can still change: not final yet, or with a
// confirmed deposit not booked yet. ponytail: scans every open invoice each run; index by due work if it grows.
func (s *Service) ProcessChain(ctx context.Context, chainID uint64) error {
	rows, err := s.pool.Query(ctx, `
		SELECT id FROM invoices i WHERE chain_id = $1 AND (payment_status IN ('open', 'detected', 'partially_paid')
		    OR EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = i.id AND t.status = 'confirmed' AND NOT t.booked))`,
		chainID)
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
		amountText, current, refund, token, receive string
		chainID, finalizedBlock                     uint64
		expiresAt, finalizedTime                    int64
	)
	err = tx.QueryRow(ctx, `
		SELECT i.amount::text, i.payment_status, i.refund_status, i.token_contract, i.receive_address, i.chain_id,
		       i.expires_at, coalesce(c.last_finalized_time, 0), coalesce(c.last_finalized_block, 0)
		FROM invoices i LEFT JOIN chain_cursors c ON c.chain_id = i.chain_id WHERE i.id = $1 FOR UPDATE OF i`,
		invoiceID).Scan(&amountText, &current, &refund, &token, &receive, &chainID, &expiresAt, &finalizedTime,
		&finalizedBlock)
	if err != nil {
		return fmt.Errorf("read invoice %s: %w", invoiceID, err)
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
	final := current == Paid || current == Expired || current == ExpiredPartiallyPaid
	for _, d := range deposits {
		value, _ := new(big.Int).SetString(d.Amount, 10)
		toCreator, toHeld := split(amount, owed, value, d.BlockTime > expiresAt, final)
		if err := book(ctx, tx, invoiceID, "deposit", &d.ID, value, toCreator, toHeld); err != nil {
			return err
		}
		owed.Add(owed, toCreator)
	}

	var anyTransfer, anyPending bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_transfers WHERE invoice_id = $1 AND status <> 'reorged'),
		EXISTS (SELECT 1 FROM chain_transfers WHERE invoice_id = $1 AND status = 'detected')`,
		invoiceID).Scan(&anyTransfer, &anyPending); err != nil {
		return fmt.Errorf("read invoice %s transfers: %w", invoiceID, err)
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
	if next == Paid && current != Paid {
		// The signer settles it; one intent per invoice (R-22).
		if _, err := tx.Exec(ctx, `WITH i AS (INSERT INTO settlement_intents (invoice_id) VALUES ($1) ON CONFLICT DO NOTHING)
			UPDATE invoices SET settlement_status = 'pending' WHERE id = $1`, invoiceID); err != nil {
			return fmt.Errorf("queue invoice %s settlement: %w", invoiceID, err)
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
	booked, onChain, err := s.compare(ctx, tx, invoiceID, chainID, finalized, token, receive)
	if err != nil || onChain == nil {
		return false, err
	}
	if onChain.Cmp(booked) > 0 {
		// A deposit the watcher never saw, or Arc USDC sent natively: an operator books it (money-safety.md).
		slog.Error("ALERT receive address holds money with no booked transfer; not expiring", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String())
		return false, nil
	}
	if onChain.Cmp(booked) < 0 {
		slog.Warn("receive address holds less than booked; not expiring", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String())
		return false, nil
	}
	return true, nil
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
