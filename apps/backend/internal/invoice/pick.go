package invoice

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// ErrPickLocked: money was seen on the invoice, so the payer's pick no longer changes (R-57).
var ErrPickLocked = errors.New("pick locked")

// PickOption keeps the option a payer picked, so the pay link opens on it again in any browser (R-57). It only shows
// the pick: money on any option still counts as R-56 says.
func (s *Service) PickOption(ctx context.Context, payToken, optionID string) error {
	id, ok := idOf(payToken)
	if !ok {
		return ErrNotFound
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Options first and the main row last, as cancel and the ledger lock them, so they can't deadlock.
		rows, err := tx.Query(ctx, `SELECT id FROM invoices WHERE coalesce(main_id, id) = $1
			ORDER BY main_id IS NULL, id FOR NO KEY UPDATE`, id)
		if err != nil {
			return fmt.Errorf("lock invoice %s options: %w", id, err)
		}
		group, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return fmt.Errorf("lock invoice %s options: %w", id, err)
		}
		if len(group) == 0 {
			return ErrNotFound
		}
		// A Fixed invoice has nothing to pick, and its pay page shows Show address as the canary expects.
		if len(group) == 1 || !slices.Contains(group, optionID) {
			return fmt.Errorf("%w: optionId: not one of this invoice's options to pick", ErrInvalid)
		}
		var chosen, seen bool
		// Dust chooses nothing (R-119), so it doesn't stop the pick being kept either.
		// A deposit 1Click converts is on its way to the Base option, as money seen is (R-233).
		if err := tx.QueryRow(ctx, `SELECT chosen_id IS NOT NULL, `+ledger.ChoosingSeenSQL+` OR `+ConvertingSQL+`
			FROM invoices WHERE id = $1`, id).Scan(&chosen, &seen); err != nil {
			return fmt.Errorf("read invoice %s money: %w", id, err)
		}
		if chosen || seen {
			return ErrPickLocked
		}
		tag, err := tx.Exec(ctx, "UPDATE invoices SET picked_id = $2 WHERE id = $1 AND picked_id IS DISTINCT FROM $2", id,
			optionID)
		if err != nil {
			return fmt.Errorf("save invoice %s pick: %w", id, err)
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		return history.Add(ctx, tx, id, history.OptionPicked, history.Payer, history.Data{Option: optionID})
	})
}
