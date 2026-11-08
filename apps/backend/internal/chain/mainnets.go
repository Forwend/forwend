package chain

import (
	"context"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EnableMainnets switches on the live chains ids names (R-222), with the tokens migration 106 added, all or none. It
// refuses an id that is not a live chain, so a typo can't switch on a testnet as real money or pass unnoticed.
func EnableMainnets(ctx context.Context, db *pgxpool.Pool, ids []uint64) error {
	want := make([]int64, len(ids))
	for i, id := range ids {
		want[i] = int64(id)
	}
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `UPDATE chains SET enabled = true WHERE livemode AND chain_id = ANY($1)
			RETURNING chain_id`, want)
		if err != nil {
			return fmt.Errorf("enable mainnets: %w", err)
		}
		on, err := pgx.CollectRows(rows, pgx.RowTo[int64])
		if err != nil {
			return fmt.Errorf("enable mainnets: %w", err)
		}
		for _, id := range want {
			if !slices.Contains(on, id) {
				return fmt.Errorf("ENABLE_MAINNETS: chain %d is not a live chain", id)
			}
		}
		return nil
	})
}
