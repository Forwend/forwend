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

// ClosedSQL is true for an invoices row (read through invoicesCurrent) whose checkout closed and that can no longer
// be paid: open, detected or partly paid, past expiry, with no payment made before expiry still confirming and less
// than the amount paid before it. Detected counts: money after the close also reads detected until the chain is final. Its status waits for the chain to be final past expiry (the ledger's rule), but every reader
// already shows it expired (R-77). Paid on time and awaiting the second RPC is not closed: that money goes to the
// creator.
const ClosedSQL = `(invoices.payment_status IN ('open', 'detected', 'partially_paid')
	AND invoices.expires_at < extract(epoch FROM now())
	AND NOT EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = invoices.option_id AND t.status = 'detected'
	                AND t.block_time <= invoices.expires_at)
	AND coalesce((SELECT sum(t.amount) FROM chain_transfers t WHERE t.invoice_id = invoices.option_id
	              AND t.status <> 'reorged' AND t.block_time <= invoices.expires_at), 0) < invoices.amount)`

// StatusFilterSQL is the filter of an invoices row: settled once settled, otherwise its payment status, with open,
// detected and partially paid as open, and both expired ones and a closed checkout (ClosedSQL) as expired.
const StatusFilterSQL = `CASE WHEN settlement_status = 'settled' THEN 'settled' WHEN payment_status = 'paid' THEN 'paid'
	WHEN payment_status IN ('expired', 'expired_partially_paid') OR ` + ClosedSQL + ` THEN 'expired'
	ELSE 'open' END`

// searchText is what a search looks in: the number as shown (INV-0042), title, note, client name and email and
// the main row's receive address. Read through invoicesCurrent, it must stay the expression of the invoices_search
// trigram index (migration 00014) on the main row's columns.
const searchText = `('INV-' || lpad(number::text, greatest(length(number::text), 4), '0') || ' ' || coalesce(title, '')
	|| ' ' || coalesce(note, '') || ' ' || coalesce(client_name, '') || ' ' || coalesce(client_email, '') || ' '
	|| main_receive_address)`

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
