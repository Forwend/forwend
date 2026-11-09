package invoice

import (
	"context"
	"fmt"
	"slices"
	"strconv"

	"github.com/forwend/forwend/apps/backend/internal/search"
	"github.com/jackc/pgx/v5"
)

const (
	DefaultLimit = 50
	MaxLimit     = 100
)

// Paid includes wallet-settled payments; the wallet filter is a narrower view.
var StatusFilters = []string{"open", "confirming", "paid", "settled", "expired", "canceled"}

// ClosedSQL: every reader shows the checkout expired before the ledger does (R-77); detected may be money after it.
// Paid on time but awaiting the finalized balance check is not closed. Before an option is chosen, every option counts (R-119).
const ClosedSQL = `((invoices.settlement_status = 'settled' AND invoices.payment_status <> 'paid') OR (invoices.payment_status IN ('open', 'detected', 'partially_paid')
	AND NOT EXISTS (SELECT 1 FROM invoices open_option
        WHERE (open_option.id = invoices.option_id OR invoices.chosen_id IS NULL AND open_option.main_id = invoices.id)
        AND open_option.closes_at >= extract(epoch FROM now()))
	AND NOT EXISTS (SELECT 1 FROM invoices o
	    WHERE (o.id = invoices.option_id OR invoices.chosen_id IS NULL AND o.main_id = invoices.id)
	      AND (EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = o.id AND t.status = 'detected'
	                   AND t.block_time <= o.closes_at)
	           OR coalesce((SELECT sum(t.amount) FROM chain_transfers t WHERE t.invoice_id = o.id
	                        AND t.status <> 'reorged' AND t.block_time <= o.closes_at), 0) >= o.amount))))`

const StatusFilterSQL = `CASE WHEN invoices.settlement_status = 'settled' AND invoices.payment_status = 'paid' THEN 'settled' WHEN invoices.payment_status = 'paid' THEN 'paid'
	WHEN invoices.payment_status = 'canceled' THEN 'canceled'
	WHEN invoices.payment_status IN ('expired', 'expired_partially_paid') OR ` + ClosedSQL + ` THEN 'expired'
	ELSE 'open' END`

// ConfirmingSQL also holds once the ledger credited the whole amount but the finalized balance check is pending: the
// status stays detected or partially_paid until then (ledger.status).
const ConfirmingSQL = `(EXISTS (SELECT 1 FROM chain_transfers t JOIN invoices candidate ON candidate.id=t.invoice_id
 WHERE (candidate.id=invoices.option_id OR invoices.chosen_id IS NULL AND candidate.main_id=invoices.id)
 AND (t.status='detected' OR t.status='confirmed' AND NOT t.booked) AND t.block_time<=candidate.closes_at)
 OR invoices.payment_status IN ('detected','partially_paid') AND (SELECT -coalesce(sum(e.amount),0) FROM ledger_transactions l
 JOIN ledger_entries e ON e.transaction_id=l.id WHERE l.invoice_id=invoices.option_id AND e.account='recipient_payable') >= invoices.amount)`

const ListStatusFilterSQL = `CASE WHEN invoices.payment_status IN ('open','detected','partially_paid') AND NOT ` + ClosedSQL + `
 AND (invoices.payment_status = 'detected' OR ` + ConfirmingSQL + `) THEN 'confirming' ELSE ` + StatusFilterSQL + ` END`

// StatusColumnsSQL is what each list status needs of the raw status columns. A filter tests it before the costly CASE,
// so the rows that can't match skip it.
var StatusColumnsSQL = map[string]string{
	"open":       "invoices.payment_status IN ('open', 'detected', 'partially_paid')",
	"confirming": "invoices.payment_status IN ('open', 'detected', 'partially_paid')",
	"paid":       "invoices.payment_status = 'paid'",
	"settled":    "invoices.payment_status = 'paid' AND invoices.settlement_status = 'settled'",
	"expired":    "invoices.payment_status NOT IN ('paid', 'canceled')",
	"canceled":   "invoices.payment_status = 'canceled'",
}

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
// stores, when not nil, keeps only those stores' invoices: a Developer's or Finance member's (R-138). live, when not
// nil, keeps only that mode's: a key's (D-87).
func (s *Service) List(ctx context.Context, profileID, cursor string, limit int, status, state string, q search.Query,
	stores []string, live *bool) (Page, error) {
	if limit < 1 || limit > MaxLimit {
		return Page{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	if status != "" && !slices.Contains(StatusFilters, status) {
		return Page{}, fmt.Errorf("%w: status must be one of %v", ErrInvalid, StatusFilters)
	}
	if state != "" && !slices.Contains(PaymentStates, state) {
		return Page{}, fmt.Errorf("%w: state must be one of %v", ErrInvalid, PaymentStates)
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
	// A link invoice reaches the owner with its number, at its first deposit (R-141).
	where := "profile_id = $1 AND number IS NOT NULL AND ($2::bigint IS NULL OR number < $2)"
	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(" AND %s AND ($%d = 'paid' AND invoices.payment_status = 'paid' OR %s = $%d)",
			StatusColumnsSQL[status], len(args), ListStatusFilterSQL, len(args))
	}
	// D-114: the same states the Payments list filters by, so both lists name a payment alike.
	if state != "" {
		args = append(args, state)
		where += fmt.Sprintf(" AND %s AND %s = $%d", PaymentStateColumnsSQL[state], PaymentStateSQL, len(args))
	}
	if stores != nil {
		args = append(args, stores)
		where += fmt.Sprintf(" AND store_id = ANY($%d::uuid[])", len(args))
	}
	if live != nil {
		args = append(args, *live)
		where += fmt.Sprintf(" AND (SELECT livemode FROM chains c WHERE c.chain_id = invoices.chain_id) = $%d", len(args))
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
		page.NextCursor = strconv.FormatInt(*page.Items[limit-1].Number, 10)
	}
	return page, nil
}
