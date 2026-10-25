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

// An invoice falls under exactly one filter (StatusFilterSQL).
var StatusFilters = []string{"open", "paid", "settled", "expired", "canceled"}

// ClosedSQL: every reader shows the checkout expired before the ledger does (R-77); detected may be money after it.
// Paid on time but awaiting the second RPC is not closed. Before an option is chosen, every option counts (R-119).
const ClosedSQL = `(invoices.payment_status IN ('open', 'detected', 'partially_paid')
	AND invoices.closes_at < extract(epoch FROM now())
	AND NOT EXISTS (SELECT 1 FROM invoices o
	    WHERE (o.id = invoices.option_id OR invoices.chosen_id IS NULL AND o.main_id = invoices.id)
	      AND (EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = o.id AND t.status = 'detected'
	                   AND t.block_time <= o.closes_at)
	           OR coalesce((SELECT sum(t.amount) FROM chain_transfers t WHERE t.invoice_id = o.id
	                        AND t.status <> 'reorged' AND t.block_time <= o.closes_at), 0) >= o.amount)))`

const StatusFilterSQL = `CASE WHEN settlement_status = 'settled' THEN 'settled' WHEN payment_status = 'paid' THEN 'paid'
	WHEN payment_status = 'canceled' THEN 'canceled'
	WHEN payment_status IN ('expired', 'expired_partially_paid') OR ` + ClosedSQL + ` THEN 'expired'
	ELSE 'open' END`

// Must stay the expression of the invoices_search trigram index (migration 00032) on the main row's columns.
const searchText = `('INV-' || lpad(number::text, greatest(length(number::text), 4), '0') || ' ' || coalesce(title, '')
	|| ' ' || coalesce(note, '') || ' ' || coalesce(client_name, '') || ' ' || coalesce(client_email, '') || ' '
	|| main_receive_address || ' ' || coalesce(reference, ''))`

// Page is one page of invoices without deposits; NextCursor is "" on the last one.
type Page struct {
	Items      []Invoice
	NextCursor string
}

// Newest first by number, which only grows. The caller must check the user's access to the profile.
// stores, when not nil, keeps only those stores' invoices: a Developer's or Finance member's (R-138).
func (s *Service) List(ctx context.Context, profileID, cursor string, limit int, status string, q search.Query,
	stores []string) (Page, error) {
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
	if stores != nil {
		args = append(args, stores)
		where += fmt.Sprintf(" AND store_id = ANY($%d::uuid[])", len(args))
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
	rows, err := s.pool.Query(ctx, "SELECT "+invoiceColumns+" FROM "+invoicesCurrent+" WHERE "+where+
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
