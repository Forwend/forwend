package ledger

import (
	"context"
	"fmt"
	"math/big"

	"github.com/jackc/pgx/v5"
)

// book writes a balanced transaction, so intoReceiver = toCreator + toHeld; a positive toCreator or toHeld is owed.
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

// Call BookSettlement in the transaction that marks the settlement confirmed; a second one is rejected.
func BookSettlement(ctx context.Context, tx pgx.Tx, invoiceID string, amount *big.Int) error {
	out := new(big.Int).Neg(amount)
	return book(ctx, tx, invoiceID, "settlement", nil, out, out, new(big.Int))
}
