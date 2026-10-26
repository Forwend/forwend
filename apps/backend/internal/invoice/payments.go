package invoice

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrPaymentNotFound  = errors.New("payment not found")
	ErrCheckoutNotFound = errors.New("checkout session not found")
)

type PaymentQuery struct {
	Cursor, StoreID string
	Limit           int
	Purpose         Purpose
	Stores          []string
	Livemode        *bool
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
	if q.Limit < 1 || q.Limit > MaxLimit {
		return Page{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	args := []any{profileID, q.Limit + 1}
	where := "profile_id = $1"
	if q.Cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(q.Cursor)
		at, id, ok := strings.Cut(string(raw), "|")
		before, parseErr := time.Parse(time.RFC3339Nano, at)
		if err != nil || parseErr != nil || !ok || len(q.Cursor) > 256 || len(id) != 66 ||
			!strings.HasPrefix(id, "0x") || strings.Trim(id[2:], "0123456789abcdef") != "" {
			return Page{}, fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
		}
		args = append(args, before, id)
		where += " AND (created_at, id) < ($3, $4)"
	}
	if q.StoreID != "" {
		var id pgtype.UUID
		if id.Scan(q.StoreID) != nil {
			return Page{}, fmt.Errorf("%w: storeId must be a UUID", ErrInvalid)
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
	rows, err := s.pool.Query(ctx, "SELECT "+invoiceColumns+" FROM "+invoicesCurrent+" WHERE "+where+
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
	return page, nil
}
