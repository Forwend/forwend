package invoice

import (
	"context"
	"fmt"
	"slices"
	"strconv"

	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/search"
	"github.com/jackc/pgx/v5"
)

const (
	DefaultLimit = 50
	MaxLimit     = 100
)

// Paid includes wallet-settled payments; the wallet filter is a narrower view.
var StatusFilters = []string{"open", "confirming", "paid", "settled", "expired", "canceled"}

// ClosedSQL: readers show the checkout expired before the ledger does; paid but unconfirmed is not closed.
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

// ConfirmingSQL also holds once the ledger owes the whole amount but the finalized balance check is pending.
var ConfirmingSQL = `(EXISTS (SELECT 1 FROM chain_transfers t JOIN invoices candidate ON candidate.id=t.invoice_id
 WHERE (candidate.id=invoices.option_id OR invoices.chosen_id IS NULL AND candidate.main_id=invoices.id)
 AND (t.status='detected' OR t.status='confirmed' AND NOT t.booked) AND t.block_time<=candidate.closes_at)
 OR invoices.payment_status IN ('detected','partially_paid') AND ` + ledger.OwedSQL("invoices.option_id") + ` >= invoices.amount)`

var ListStatusFilterSQL = `CASE WHEN invoices.payment_status IN ('open','detected','partially_paid') AND NOT ` + ClosedSQL + `
 AND (invoices.payment_status = 'detected' OR ` + ConfirmingSQL + `) THEN 'confirming' ELSE ` + StatusFilterSQL + ` END`

// StatusColumnsSQL is what each list status needs of the raw columns, tested before the costly CASE.
var StatusColumnsSQL = map[string]string{
	"open":       "invoices.payment_status IN ('open', 'detected', 'partially_paid')",
	"confirming": "invoices.payment_status IN ('open', 'detected', 'partially_paid')",
	"paid":       "invoices.payment_status = 'paid'",
	"settled":    "invoices.payment_status = 'paid' AND invoices.settlement_status = 'settled'",
	"expired":    "invoices.payment_status NOT IN ('paid', 'canceled')",
	"canceled":   "invoices.payment_status = 'canceled'",
}

// Must stay the expression of the invoices_search trigram index.
const searchText = `('INV-' || lpad(number::text, greatest(length(number::text), 4), '0') || ' ' || coalesce(title, '')
	|| ' ' || coalesce(note, '') || ' ' || coalesce(client_name, '') || ' ' || coalesce(client_email, '') || ' '
	|| main_receive_address || ' ' || coalesce(reference, ''))`

type Page struct {
	Items      []Invoice
	NextCursor string // "" on the last page
}

// List is newest first by number; non-nil stores and live narrow it. The caller checks profile access.
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
	where := "profile_id = $1 AND number IS NOT NULL AND ($2::bigint IS NULL OR number < $2)"
	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(" AND %s AND ($%d = 'paid' AND invoices.payment_status = 'paid' OR %s = $%d)",
			StatusColumnsSQL[status], len(args), ListStatusFilterSQL, len(args))
	}
	// The same states the Payments list filters by, so both lists name a payment alike.
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
