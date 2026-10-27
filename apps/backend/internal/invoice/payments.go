package invoice

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrPaymentNotFound  = errors.New("payment not found")
	ErrCheckoutNotFound = errors.New("checkout session not found")
)

type paymentReader interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type PaymentSource string

const (
	SourceInvoice     PaymentSource = PaymentSource(PurposeInvoice)
	SourceCheckout    PaymentSource = PaymentSource(PurposeCheckout)
	SourceRequest     PaymentSource = PaymentSource(PurposeRequest)
	SourcePaymentLink PaymentSource = "payment_link"
)

func (i Invoice) PaymentSource() PaymentSource {
	if i.LinkID != "" {
		return SourcePaymentLink
	}
	return PaymentSource(i.Purpose)
}

type PaymentQuery struct {
	IncludeWebhookOperations                              bool
	Attention                                             bool
	Cursor, StoreID                                       string
	Source                                                PaymentSource
	Status, PaymentStatus, SettlementStatus, RefundStatus string
	Limit                                                 int
	Purpose                                               Purpose
	Stores                                                []string
	Livemode                                              *bool
}

func (s *Service) Payment(ctx context.Context, profileID, id string) (Invoice, error) {
	inv, err := s.GetOfProfile(ctx, profileID, id)
	if errors.Is(err, ErrNotFound) || err == nil && inv.ID != strings.ToLower(id) {
		return Invoice{}, ErrPaymentNotFound
	}
	return inv, err
}

// Payments includes attempts without documents; its cursor never depends on invoice numbering.
func (s *Service) Payments(ctx context.Context, profileID string, q PaymentQuery) (Page, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Page{}, err
	}
	defer tx.Rollback(ctx)
	page, err := readPaymentPage(ctx, tx, profileID, q)
	if err != nil {
		return Page{}, err
	}
	return page, tx.Commit(ctx)
}

func readPaymentPage(ctx context.Context, db paymentReader, profileID string, q PaymentQuery) (Page, error) {
	args, where, err := paymentWhere(profileID, q)
	if err != nil {
		return Page{}, err
	}
	rows, err := db.Query(ctx, "SELECT "+invoiceColumns+" FROM "+invoicesCurrent+" WHERE "+where+
		" ORDER BY created_at DESC, id DESC LIMIT $2", args...)
	if err != nil {
		return Page{}, fmt.Errorf("list payments: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Invoice, error) { return scanInvoice(row) })
	if err != nil {
		return Page{}, fmt.Errorf("list payments: %w", err)
	}
	page := Page{Items: items}
	if len(items) > q.Limit {
		page.Items = items[:q.Limit]
		last := page.Items[q.Limit-1]
		page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(last.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + last.ID))
	}
	ids := make([]string, len(page.Items))
	for i := range page.Items {
		ids[i] = page.Items[i].OptionID
	}
	amounts, err := ledger.ReadAmountsFor(ctx, db, ids)
	if err != nil {
		return Page{}, err
	}
	for i := range page.Items {
		page.Items[i].Amounts = amounts[page.Items[i].OptionID]
	}
	return page, nil
}

func paymentWhere(profileID string, q PaymentQuery) ([]any, string, error) {
	if q.Limit < 1 || q.Limit > MaxLimit {
		return nil, "", fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	args := []any{profileID, q.Limit + 1}
	where := "profile_id = $1"
	if q.Cursor != "" {
		if len(q.Cursor) > 256 {
			return nil, "", fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
		}
		raw, err := base64.RawURLEncoding.DecodeString(q.Cursor)
		at, id, ok := strings.Cut(string(raw), "|")
		before, parseErr := time.Parse(time.RFC3339Nano, at)
		if err != nil || parseErr != nil || !ok || len(id) != 66 ||
			!strings.HasPrefix(id, "0x") || strings.Trim(id[2:], "0123456789abcdef") != "" {
			return nil, "", fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
		}
		args = append(args, before, id)
		where += " AND (created_at, id) < ($3, $4)"
	}
	if q.StoreID != "" {
		var id pgtype.UUID
		if id.Scan(q.StoreID) != nil {
			return nil, "", fmt.Errorf("%w: storeId must be a UUID", ErrInvalid)
		}
		args = append(args, id)
		where += fmt.Sprintf(" AND store_id = $%d", len(args))
	}
	if q.Stores != nil {
		args = append(args, q.Stores)
		where += fmt.Sprintf(" AND store_id = ANY($%d::uuid[])", len(args))
	}
	if q.Livemode != nil {
		args = append(args, *q.Livemode)
		where += fmt.Sprintf(" AND (SELECT livemode FROM chains c WHERE c.chain_id = invoices.chain_id) = $%d", len(args))
	}
	if q.Purpose != "" {
		args = append(args, q.Purpose)
		where += fmt.Sprintf(" AND purpose = $%d", len(args))
	}
	if q.Source != "" {
		switch q.Source {
		case SourcePaymentLink:
			where += " AND link_id IS NOT NULL"
		case SourceInvoice, SourceCheckout, SourceRequest:
			args = append(args, string(q.Source))
			where += fmt.Sprintf(" AND purpose = $%d AND link_id IS NULL", len(args))
		default:
			return nil, "", fmt.Errorf("%w: source must be invoice, checkout, payment_link or request", ErrInvalid)
		}
	}
	if q.Status != "" {
		if !slices.Contains(StatusFilters, q.Status) {
			return nil, "", fmt.Errorf("%w: invalid status", ErrInvalid)
		}
		args = append(args, q.Status)
		where += fmt.Sprintf(" AND %s = $%d", StatusFilterSQL, len(args))
	}
	for _, filter := range []struct {
		column, value string
		allowed       []string
	}{
		{"payment_status", q.PaymentStatus, []string{ledger.Open, ledger.Detected, ledger.PartiallyPaid, ledger.Paid, ledger.Expired, ledger.ExpiredPartiallyPaid, ledger.Canceled}},
		{"settlement_status", q.SettlementStatus, []string{"none", "pending", "settled"}},
		{"refund_status", q.RefundStatus, []string{"none", "held", "refund_pending", "refunded"}},
	} {
		if filter.value == "" {
			continue
		}
		if !slices.Contains(filter.allowed, filter.value) {
			return nil, "", fmt.Errorf("%w: invalid %s", ErrInvalid, filter.column)
		}
		args = append(args, filter.value)
		where += fmt.Sprintf(" AND %s = $%d", filter.column, len(args))
	}
	if q.Attention {
		args = append(args, int64(SettlementAttentionAfter/time.Second))
		where += " AND (" + paymentAttentionSQL(fmt.Sprintf("$%d", len(args))) + ")"
	}
	return args, where, nil
}
