package invoice

import (
	"context"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"
)

const (
	DefaultLimit = 50
	MaxLimit     = 100
)

// Page is one page of invoices without deposits; NextCursor is "" on the last one.
type Page struct {
	Items      []Invoice
	NextCursor string
}

// List returns the profile's invoices after cursor ("" for the first), newest first: by number, which only grows.
// The caller has checked that the user owns the profile.
func (s *Service) List(ctx context.Context, profileID, cursor string, limit int) (Page, error) {
	if limit < 1 || limit > MaxLimit {
		return Page{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	var before *int64
	if cursor != "" {
		n, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil {
			return Page{}, fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
		}
		before = &n
	}
	rows, err := s.pool.Query(ctx, "SELECT "+invoiceColumns+` FROM invoices
		WHERE profile_id = $1 AND ($2::bigint IS NULL OR number < $2) ORDER BY number DESC LIMIT $3`,
		profileID, before, limit+1)
	if err != nil {
		return Page{}, fmt.Errorf("list invoices: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Invoice, error) { return scanInvoice(row) })
	if err != nil {
		return Page{}, fmt.Errorf("list invoices: %w", err)
	}
	page := Page{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		page.NextCursor = strconv.FormatInt(page.Items[limit-1].Number, 10)
	}
	return page, nil
}
