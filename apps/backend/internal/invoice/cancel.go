package invoice

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

// ErrNotCancelable: the invoice is not open, its checkout has closed, or money was seen for it.
var ErrNotCancelable = errors.New("invoice can't be canceled")

// Cancel cancels the profile's invoice and all its options (R-79, D-79), only while every row is open, the checkout
// has not closed and no transfer was ever recorded for any of them. It locks the rows the ledger locks, so the two
// never decide at once. A transfer the watcher records after the cancel is held for the payer: the ledger treats
// canceled as final (D-26).
func (s *Service) Cancel(ctx context.Context, profileID, id string) (Invoice, error) {
	id = strings.ToLower(id)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Invoice{}, fmt.Errorf("cancel invoice %s: %w", id, err)
	}
	defer tx.Rollback(ctx)
	// Options first, the main row last: the ledger locks an option, then its main row, so the two never wait on each
	// other.
	rows, err := tx.Query(ctx, `SELECT payment_status, expires_at FROM invoices
		WHERE coalesce(main_id, id) = $1 AND profile_id = $2 ORDER BY main_id IS NULL, id FOR UPDATE`, id, profileID)
	if err != nil {
		return Invoice{}, fmt.Errorf("lock invoice %s: %w", id, err)
	}
	type row struct {
		Status    string
		ExpiresAt int64
	}
	locked, err := pgx.CollectRows(rows, pgx.RowToStructByPos[row])
	if err != nil {
		return Invoice{}, fmt.Errorf("lock invoice %s: %w", id, err)
	}
	if len(locked) == 0 {
		return Invoice{}, ErrNotFound
	}
	for _, r := range locked {
		if r.Status != "open" || r.ExpiresAt <= s.now().Unix() {
			return Invoice{}, ErrNotCancelable
		}
	}
	var seen bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_transfers t JOIN invoices i ON i.id = t.invoice_id
		WHERE coalesce(i.main_id, i.id) = $1 AND t.status <> 'reorged')`, id).Scan(&seen); err != nil {
		return Invoice{}, fmt.Errorf("read invoice %s transfers: %w", id, err)
	}
	if seen {
		return Invoice{}, ErrNotCancelable
	}
	if _, err := tx.Exec(ctx, `UPDATE invoices SET payment_status = 'canceled', canceled_at = now()
		WHERE coalesce(main_id, id) = $1`, id); err != nil {
		return Invoice{}, fmt.Errorf("cancel invoice %s: %w", id, err)
	}
	if err := history.Add(ctx, tx, id, history.Canceled, history.Owner, history.Data{}); err != nil {
		return Invoice{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Invoice{}, fmt.Errorf("cancel invoice %s: %w", id, err)
	}
	return s.GetOfProfile(ctx, profileID, id)
}
