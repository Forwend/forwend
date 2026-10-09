package ledger

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BalanceTimeout bounds one second-RPC balance call.
const BalanceTimeout = 10 * time.Second

type Service struct {
	pool    *pgxpool.Pool
	balance BalanceOf
}

func NewService(pool *pgxpool.Pool, balance BalanceOf) *Service {
	return &Service{pool: pool, balance: balance}
}

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
		chainID                                     uint64
		expiresAt, finalizedTime                    int64
	)
	err = tx.QueryRow(ctx, `
		SELECT i.amount::text, i.payment_status, i.refund_status, i.token_contract, i.receive_address, i.chain_id,
		       i.expires_at, coalesce(c.last_finalized_time, 0)
		FROM invoices i LEFT JOIN chain_cursors c ON c.chain_id = i.chain_id WHERE i.id = $1 FOR UPDATE OF i`,
		invoiceID).Scan(&amountText, &current, &refund, &token, &receive, &chainID, &expiresAt, &finalizedTime)
	if err != nil {
		return fmt.Errorf("read invoice %s: %w", invoiceID, err)
	}
	amount, _ := new(big.Int).SetString(amountText, 10)
	owed, err := accountBalance(ctx, tx, invoiceID, "recipient_payable")
	if err != nil {
		return err
	}
	owed.Neg(owed) // credit balances are negative

	rows, err := tx.Query(ctx, `
		SELECT id, amount::text, block_time FROM chain_transfers
		WHERE invoice_id = $1 AND status = 'confirmed' AND NOT booked ORDER BY block_number, log_index`, invoiceID)
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
		if funded, err = s.funded(ctx, tx, invoiceID, chainID, token, receive); err != nil {
			return err
		}
	case finalizedTime > expiresAt && !anyPending:
		// Expiry is final, so the ledger must explain the whole balance first: more on chain than booked is a
		// deposit the watcher hasn't booked yet (a missed log, an Arc native-coin payment).
		if mayExpire, err = s.balanced(ctx, tx, invoiceID, chainID, token, receive); err != nil {
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
	return tx.Commit(ctx)
}

// funded asks the second RPC whether the receive address holds at least every booked deposit (D-15).
func (s *Service) funded(ctx context.Context, tx pgx.Tx, invoiceID string, chainID uint64, token, receive string) (bool, error) {
	booked, onChain, err := s.compare(ctx, tx, invoiceID, chainID, token, receive)
	if err != nil {
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
func (s *Service) balanced(ctx context.Context, tx pgx.Tx, invoiceID string, chainID uint64, token, receive string) (bool, error) {
	booked, onChain, err := s.compare(ctx, tx, invoiceID, chainID, token, receive)
	if err != nil {
		return false, err
	}
	if onChain.Cmp(booked) != 0 {
		slog.Warn("receive address balance differs from the ledger; not expiring", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String())
		return false, nil
	}
	return true, nil
}

// compare returns the booked receiver balance and the second RPC's balance.
// ponytail: the RPC call runs inside the transaction holding the invoice lock, bounded by BalanceTimeout.
func (s *Service) compare(ctx context.Context, tx pgx.Tx, invoiceID string, chainID uint64, token, receive string) (booked, onChain *big.Int, err error) {
	if booked, err = accountBalance(ctx, tx, invoiceID, "receiver"); err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, BalanceTimeout)
	defer cancel()
	if onChain, err = s.balance(ctx, chainID, token, receive); err != nil {
		return nil, nil, fmt.Errorf("check invoice %s balance: %w", invoiceID, err)
	}
	return booked, onChain, nil
}

// book writes one balanced ledger transaction: the receiver changes by intoReceiver, the creator's account by
// toCreator and the payer's by toHeld (credits are negative; a positive amount is owed).
func book(ctx context.Context, tx pgx.Tx, invoiceID, kind string, transferID *int64, intoReceiver, toCreator, toHeld *big.Int) error {
	var id int64
	if err := tx.QueryRow(ctx, `INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id) VALUES ($1, $2, $3)
		RETURNING id`, invoiceID, kind, transferID).Scan(&id); err != nil {
		return fmt.Errorf("book invoice %s %s: %w", invoiceID, kind, err)
	}
	for account, amount := range map[string]*big.Int{
		"receiver": intoReceiver, "recipient_payable": new(big.Int).Neg(toCreator), "payer_held": new(big.Int).Neg(toHeld),
	} {
		if amount.Sign() == 0 {
			continue
		}
		if _, err := tx.Exec(ctx, "INSERT INTO ledger_entries (transaction_id, account, amount) VALUES ($1, $2, $3)",
			id, account, amount.String()); err != nil {
			return fmt.Errorf("book invoice %s %s: %w", invoiceID, kind, err)
		}
	}
	return nil
}

// accountBalance sums one of the invoice's ledger accounts (debit positive).
func accountBalance(ctx context.Context, tx pgx.Tx, invoiceID, account string) (*big.Int, error) {
	var text string
	err := tx.QueryRow(ctx, `SELECT coalesce(sum(e.amount), 0)::text FROM ledger_entries e
		JOIN ledger_transactions t ON t.id = e.transaction_id WHERE t.invoice_id = $1 AND e.account = $2`,
		invoiceID, account).Scan(&text)
	if err != nil {
		return nil, fmt.Errorf("read invoice %s %s balance: %w", invoiceID, account, err)
	}
	n, _ := new(big.Int).SetString(text, 10)
	return n, nil
}
