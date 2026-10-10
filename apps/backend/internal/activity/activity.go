// Package activity lists a profile's invoices and deposits (R-33) and its wallet's token transfers (R-38), newest
// first, in cursor pages.
package activity

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Item kinds.
const (
	Invoice = "invoice"
	Deposit = "deposit"
)

const (
	DefaultLimit = 50
	MaxLimit     = 100
)

// ErrInvalid wraps a cursor or limit that breaks a rule.
var ErrInvalid = errors.New("invalid activity request")

// Item is an invoice made or a deposit seen (reorged ones are left out). For an invoice, Status is its payment status,
// SettlementStatus is set and TxHash is the settle transaction once settled; for a deposit, Status is detected or
// confirmed and TxHash is set.
type Item struct {
	Kind             string
	At               time.Time
	InvoiceID        string
	ChainID          uint64
	Token            string
	Symbol           string // the token's symbol and decimals, also for a token no longer enabled
	Decimals         int
	Amount           *big.Int
	Status           string
	SettlementStatus string
	TxHash           string
	key              string
}

// Page is one page; NextCursor is "" on the last one.
type Page struct {
	Items      []Item
	NextCursor string
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// List returns the page after cursor ("" for the first). The caller has checked that the user owns the profile.
func (s *Service) List(ctx context.Context, profileID, cursor string, limit int) (Page, error) {
	if limit < 1 || limit > MaxLimit {
		return Page{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	var after *time.Time
	var afterKind, afterKey string
	if cursor != "" {
		at, kind, key, err := decode(cursor)
		if err != nil {
			return Page{}, err
		}
		after, afterKind, afterKey = &at, kind, key
	}
	// Newest first; kind and key break ties, so pages never skip or repeat an item.
	rows, err := s.pool.Query(ctx, `
		SELECT kind, at, key, invoice_id, a.chain_id, token, tk.symbol, tk.decimals, amount::text, status,
		       settlement_status, tx_hash FROM (
		    SELECT 'invoice' AS kind, created_at AS at, id AS key, id AS invoice_id, chain_id,
		           token_contract AS token, amount, payment_status AS status, settlement_status,
		           coalesce((SELECT s.tx_hash FROM settlement_intents s WHERE s.invoice_id = invoices.id
		                     AND s.status = 'confirmed'), '') AS tx_hash
		    FROM invoices WHERE profile_id = $1
		    UNION ALL
		    SELECT 'deposit', t.created_at, t.id::text, t.invoice_id, t.chain_id, t.token_contract, t.amount, t.status,
		           '', t.tx_hash
		    FROM chain_transfers t JOIN invoices i ON i.id = t.invoice_id
		    WHERE i.profile_id = $1 AND t.status <> 'reorged'
		) a JOIN tokens tk ON tk.chain_id = a.chain_id AND tk.contract = a.token
		WHERE $2::timestamptz IS NULL OR (at, kind, key) < ($2, $3, $4)
		ORDER BY at DESC, kind DESC, key DESC LIMIT $5`, profileID, after, afterKind, afterKey, limit+1)
	if err != nil {
		return Page{}, fmt.Errorf("read activity: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Item, error) {
		var it Item
		var amount string
		err := row.Scan(&it.Kind, &it.At, &it.key, &it.InvoiceID, &it.ChainID, &it.Token, &it.Symbol, &it.Decimals,
			&amount, &it.Status, &it.SettlementStatus, &it.TxHash)
		it.Amount, _ = new(big.Int).SetString(amount, 10)
		return it, err
	})
	if err != nil {
		return Page{}, fmt.Errorf("read activity: %w", err)
	}
	page := Page{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[limit-1]
		page.NextCursor = encode(last.At, last.Kind, last.key)
	}
	return page, nil
}

// A cursor is the last item's time (Unix microseconds, Postgres' precision), kind and key.
func encode(at time.Time, kind, key string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d|%s|%s", at.UnixMicro(), kind, key)))
}

func decode(cursor string) (time.Time, string, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	parts := strings.SplitN(string(raw), "|", 3)
	if err != nil || len(parts) != 3 || (parts[1] != Invoice && parts[1] != Deposit) {
		return time.Time{}, "", "", fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
	}
	micros, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return time.Time{}, "", "", fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
	}
	return time.UnixMicro(micros), parts[1], parts[2], nil
}
