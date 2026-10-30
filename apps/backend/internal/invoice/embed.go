package invoice

import (
	"context"
	"errors"
	"fmt"

	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

// EmbedAllowed reports whether a page at origin may frame the checkout of the invoice with payToken (R-168): an
// exact origin of the store the invoice records, and https unless the invoice is in test mode. It never lists the
// store's origins: anyone with the pay token may ask.
func (s *Service) EmbedAllowed(ctx context.Context, payToken, origin string) (bool, error) {
	id, ok := idOf(payToken)
	if !ok {
		return false, ErrNotFound
	}
	var origins []string
	var live bool
	err := s.pool.QueryRow(ctx, `SELECT coalesce(s.allowed_origins, '{}'), c.livemode FROM invoices i
		JOIN chains c ON c.chain_id = i.chain_id LEFT JOIN stores s ON s.id = i.store_id
		WHERE i.id = (SELECT coalesce(main_id, id) FROM invoices WHERE id = $1)`, id).Scan(&origins, &live)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, fmt.Errorf("read invoice %s store origins: %w", id, err)
	}
	return profile.FramedBy(origins, origin, live), nil
}
