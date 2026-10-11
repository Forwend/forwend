package invoice

import (
	"context"
	"fmt"
	"slices"
	"strconv"

	"github.com/ensp1re/forwend/apps/backend/internal/search"
	"github.com/jackc/pgx/v5"
)

const (
	DefaultLimit = 50
	MaxLimit     = 100
)

// StatusFilters are the owner's list filters; an invoice falls under exactly one (StatusFilterSQL).
var StatusFilters = []string{"open", "paid", "settled", "expired"}

// StatusFilterSQL is the filter of an invoices row: settled once settled, otherwise its payment status, with open,
// detected and partially paid as open and both expired ones as expired.
const StatusFilterSQL = `CASE WHEN settlement_status = 'settled' THEN 'settled' WHEN payment_status = 'paid' THEN 'paid'
	WHEN payment_status IN ('expired', 'expired_partially_paid') THEN 'expired' ELSE 'open' END`

// searchText is what a search looks in: the number as shown (INV-0042), title, note, client name and email and
// receive address. It must stay the expression of the invoices_search trigram index (migration 00014).
const searchText = `('INV-' || lpad(number::text, greatest(length(number::text), 4), '0') || ' ' || coalesce(title, '')
	|| ' ' || coalesce(note, '') || ' ' || coalesce(client_name, '') || ' ' || coalesce(client_email, '') || ' '
	|| receive_address)`

// Page is one page of invoices without deposits; NextCursor is "" on the last one.
type Page struct {
	Items      []Invoice
	NextCursor string
}

// List returns the profile's invoices under status ("" for all) that match q, after cursor ("" for the first), newest
// first: by number, which only grows. The caller has checked that the user owns the profile.
func (s *Service) List(ctx context.Context, profileID, cursor string, limit int, status string, q search.Query) (Page, error) {
	if limit < 1 || limit > MaxLimit {
		return Page{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	if status != "" && !slices.Contains(StatusFilters, status) {
		return Page{}, fmt.Errorf("%w: status must be one of %v", ErrInvalid, StatusFilters)
	}
	var before *int64
	if cursor != "" {
		n, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil {
			return Page{}, fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
		}
		before = &n
	}
	// Each condition is added only when used: a cached generic plan of "$n IS NULL OR ..." never uses the index.
	args := []any{profileID, before, limit + 1}
	where := "profile_id = $1 AND ($2::bigint IS NULL OR number < $2)"
	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(" AND %s = $%d", StatusFilterSQL, len(args))
	}
	if q.Like != nil {
		args = append(args, *q.Like)
		match := fmt.Sprintf("%s ILIKE $%d", searchText, len(args))
		if q.Amount != nil {
			args = append(args, *q.Amount)
			match += fmt.Sprintf(` OR amount = $%d::numeric * 10::numeric ^ (SELECT decimals FROM tokens t
				WHERE t.chain_id = invoices.chain_id AND t.contract = invoices.token_contract)`, len(args))
		}
		where += " AND (" + match + ")"
	}
	rows, err := s.pool.Query(ctx, "SELECT "+invoiceColumns+" FROM invoices WHERE "+where+
		" ORDER BY number DESC LIMIT $3", args...)
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
