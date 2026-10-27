package ledger

import (
	"context"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

// Unconfirmed observation updates the payment's waiting state without choosing an option or booking money.
func (s *Service) observe(ctx context.Context, invoiceID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT id FROM invoices WHERE coalesce(main_id,id) =
  (SELECT coalesce(main_id,id) FROM invoices WHERE id = $1) ORDER BY main_id IS NULL,id FOR NO KEY UPDATE`, invoiceID); err != nil {
		return err
	}
	var group, current string
	var chosen *string
	var seen bool
	if err := tx.QueryRow(ctx, `SELECT m.id,m.payment_status,m.chosen_id,EXISTS (
  SELECT 1 FROM chain_transfers t JOIN invoices candidate ON candidate.id = t.invoice_id
  WHERE coalesce(candidate.main_id,candidate.id) = m.id AND t.status <> 'reorged')
  FROM invoices i JOIN invoices m ON m.id = coalesce(i.main_id,i.id) WHERE i.id = $1`, invoiceID).
		Scan(&group, &current, &chosen, &seen); err != nil {
		return err
	}
	if chosen != nil {
		return nil
	}
	return recordObservation(ctx, tx, group, current, seen)
}

func recordAwaitingChoice(ctx context.Context, tx pgx.Tx, invoiceID, group, current string) error {
	if invoiceID != group {
		return nil
	}
	return recordObservation(ctx, tx, group, current, true)
}

func recordObservation(ctx context.Context, tx pgx.Tx, group, current string, seen bool) error {
	if current != Open && current != Detected {
		return nil
	}
	next := Open
	if seen {
		next = Detected
	}
	if next != current {
		if _, err := tx.Exec(ctx, "UPDATE invoices SET payment_status = $2 WHERE id = $1", group, next); err != nil {
			return err
		}
		if err := history.Add(ctx, tx, group, "invoice."+next, history.System, history.Data{}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
