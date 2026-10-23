package invoice

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Views counts the pay page's loads (R-125); nothing says who loaded it.
type Views struct {
	Count           int64
	FirstAt, LastAt time.Time // zero before the first load
}

// CountView counts one load of the pay page.
func (s *Service) CountView(ctx context.Context, payToken string) error {
	id, ok := idOf(payToken)
	if !ok {
		return ErrNotFound
	}
	tag, err := s.pool.Exec(ctx, `INSERT INTO invoice_views (invoice_id) SELECT id FROM invoices WHERE id = $1
		ON CONFLICT (invoice_id) DO UPDATE SET last_at = now(), views = invoice_views.views + 1`, id)
	if err != nil {
		return fmt.Errorf("count invoice %s view: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) views(ctx context.Context, id string) (Views, error) {
	var v Views
	err := s.pool.QueryRow(ctx, "SELECT views, first_at, last_at FROM invoice_views WHERE invoice_id = $1", id).
		Scan(&v.Count, &v.FirstAt, &v.LastAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Views{}, nil
	} else if err != nil {
		return Views{}, fmt.Errorf("read invoice %s views: %w", id, err)
	}
	v.FirstAt, v.LastAt = v.FirstAt.UTC(), v.LastAt.UTC()
	return v, nil
}
