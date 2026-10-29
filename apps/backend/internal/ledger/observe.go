package ledger

import (
	"context"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

// recordAwaitingChoice shows money seen on a payer-chooses invoice while the choice waits (R-119): open becomes detected.
func recordAwaitingChoice(ctx context.Context, tx pgx.Tx, invoiceID, group, current string) error {
	if invoiceID != group || current != Open {
		return nil
	}
	if _, err := tx.Exec(ctx, "UPDATE invoices SET payment_status = $2 WHERE id = $1", group, Detected); err != nil {
		return err
	}
	if err := history.Add(ctx, tx, group, "invoice."+Detected, history.System, history.Data{}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
