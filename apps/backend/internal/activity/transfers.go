package activity

import (
	"context"
	"encoding/base64"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/search"
	"github.com/jackc/pgx/v5"
)

// Transfer is an enabled-token transfer from or to the profile's wallet (R-38). Direction is "in" or "out"; Status is
// detected or confirmed (reorged ones are left out); At is the block time. Invoice, Label and own say what it was
// (R-108): see Classification.
type Transfer struct {
	chain.Asset
	Direction    string
	Amount       *big.Int
	Counterparty string
	TxHash       string
	LogIndex     uint64
	BlockNumber  uint64
	At           time.Time
	Status       string
	Invoice      *TransferInvoice
	Label        string
	// RecordsCurrency is the profile's other records currency, "" for none (R-110); fx its ECB rates for this transfer.
	RecordsCurrency string
	fx              *rates
	own             bool
	id              int64
}

// rates are the ECB's euro rates of the latest day on or before a transfer's UTC day, within 7 days: USD and the
// records currency per 1 EUR.
type rates struct {
	day      time.Time
	usd, cur *big.Rat
}

// transferSQL selects a profile's transfers ($1) with what classifies them (R-108): the invoice money in paid (sent
// from one of its receive addresses), whether the counterparty is another of the user's profiles, and the user's label.
// With a records currency it adds the ECB rates that value the transfer (R-110).
const transferSQL = `
	SELECT t.id, t.chain_id, t.token_contract, tk.symbol, tk.decimals, t.direction, t.amount::text, t.counterparty,
	       t.tx_hash, t.log_index, t.block_number, t.block_time, t.status, inv.id, inv.number, inv.client_name,
	       EXISTS (SELECT 1 FROM profile_wallets ow JOIN profiles op ON op.id = ow.profile_id
	               WHERE op.user_id = p.user_id AND op.id <> p.id AND ow.chain_family = t.chain_family
	                 AND ow.address = t.counterparty),
	       coalesce(l.label, ''), coalesce(p.records_currency, ''), fx.day, fx.usd::text, fx.cur::text
	FROM wallet_transfers t
	JOIN profile_wallets w ON w.chain_family = t.chain_family AND w.address = t.wallet_address
	JOIN profiles p ON p.id = w.profile_id
	JOIN tokens tk ON tk.chain_id = t.chain_id AND tk.contract = t.token_contract
	LEFT JOIN LATERAL (SELECT m.id, m.number, m.client_name FROM invoices o JOIN invoices m ON m.id = coalesce(o.main_id, o.id)
	                   WHERE t.direction = 'in' AND o.chain_id = t.chain_id AND o.receive_address = t.counterparty
	                     AND m.profile_id = p.id) inv ON true
	LEFT JOIN transfer_labels l ON l.profile_id = p.id AND l.chain_id = t.chain_id AND l.tx_hash = t.tx_hash
	     AND l.log_index = t.log_index
	LEFT JOIN LATERAL (SELECT u.day, u.per_eur AS usd, CASE WHEN p.records_currency = 'EUR' THEN 1 ELSE c.per_eur END AS cur
	                   FROM ecb_rates u LEFT JOIN ecb_rates c ON c.currency = p.records_currency AND c.day = u.day
	                   WHERE p.records_currency IS NOT NULL AND u.currency = 'USD'
	                     AND u.day <= (to_timestamp(t.block_time) AT TIME ZONE 'UTC')::date
	                     -- The ECB closes at most 4 days in a row (Easter): an older rate is a missed read, so none.
	                     AND u.day > (to_timestamp(t.block_time) AT TIME ZONE 'UTC')::date - 7
	                   ORDER BY u.day DESC LIMIT 1) fx ON true
	WHERE w.profile_id = $1 AND t.status <> 'reorged'`

func scanTransfer(row pgx.CollectableRow) (Transfer, error) {
	var (
		t               Transfer
		amount          string
		at              int64
		invoice, client *string
		number          *int64
		day             *time.Time
		usd, cur        *string
	)
	err := row.Scan(&t.id, &t.ChainID, &t.Token, &t.Symbol, &t.Decimals, &t.Direction, &amount, &t.Counterparty,
		&t.TxHash, &t.LogIndex, &t.BlockNumber, &at, &t.Status, &invoice, &number, &client, &t.own, &t.Label,
		&t.RecordsCurrency, &day, &usd, &cur)
	if day != nil && usd != nil && cur != nil {
		t.fx = &rates{day: *day}
		t.fx.usd, _ = new(big.Rat).SetString(*usd)
		t.fx.cur, _ = new(big.Rat).SetString(*cur)
	}
	t.Amount, _ = new(big.Int).SetString(amount, 10)
	t.At = time.Unix(at, 0).UTC()
	if invoice != nil {
		t.Invoice = &TransferInvoice{ID: *invoice, Number: *number}
		if client != nil {
			t.Invoice.ClientName = *client
		}
	}
	return t, err
}

// TransferPage is one page of transfers; NextCursor is "" on the last one.
type TransferPage struct {
	Items      []Transfer
	NextCursor string
}

// Transfers returns the page of the profile wallet's transfers in direction ("" for both) whose counterparty,
// transaction hash, token symbol or amount matches q, after cursor ("" for the first), newest block time first. The
// caller has checked that the user owns the profile.
func (s *Service) Transfers(ctx context.Context, profileID, cursor string, limit int, direction string,
	q search.Query) (TransferPage, error) {
	if limit < 1 || limit > MaxLimit {
		return TransferPage{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	var only *string
	if direction != "" {
		if direction != "in" && direction != "out" {
			return TransferPage{}, fmt.Errorf("%w: direction must be in or out", ErrInvalid)
		}
		only = &direction
	}
	var afterTime, afterID *int64
	if cursor != "" {
		at, id, err := decodeTransfer(cursor)
		if err != nil {
			return TransferPage{}, err
		}
		afterTime, afterID = &at, &id
	}
	// The row id breaks ties within one block time, so pages never skip or repeat a transfer.
	rows, err := s.pool.Query(ctx, transferSQL+`
		  AND ($2::bigint IS NULL OR (t.block_time, t.id) < ($2, $3)) AND ($5::text IS NULL OR t.direction = $5)
		  AND ($6::text IS NULL OR t.counterparty ILIKE $6 OR t.tx_hash ILIKE $6 OR tk.symbol ILIKE $6
		       OR t.amount = $7::numeric * 10::numeric ^ tk.decimals)
		ORDER BY t.block_time DESC, t.id DESC LIMIT $4`, profileID, afterTime, afterID, limit+1, only, q.Like, q.Amount)
	if err != nil {
		return TransferPage{}, fmt.Errorf("read wallet transfers: %w", err)
	}
	items, err := pgx.CollectRows(rows, scanTransfer)
	if err != nil {
		return TransferPage{}, fmt.Errorf("read wallet transfers: %w", err)
	}
	page := TransferPage{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[limit-1]
		page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d|%d", last.At.Unix(), last.id)))
	}
	return page, nil
}

// decodeTransfer reads a transfers cursor: the last item's block time and row id.
func decodeTransfer(cursor string) (at, id int64, err error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	parts := strings.Split(string(raw), "|")
	if err == nil && len(parts) == 2 {
		if at, err = strconv.ParseInt(parts[0], 10, 64); err == nil {
			if id, err = strconv.ParseInt(parts[1], 10, 64); err == nil {
				return at, id, nil
			}
		}
	}
	return 0, 0, fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
}
