package activity

import (
	"context"
	"encoding/base64"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Transfer is an enabled-token transfer from or to the profile's wallet (R-38). Direction is "in" or "out"; Status is
// detected or confirmed (reorged ones are left out); At is the block time.
type Transfer struct {
	ChainID      uint64
	Token        string
	Symbol       string
	Decimals     int
	Direction    string
	Amount       *big.Int
	Counterparty string
	TxHash       string
	LogIndex     uint64
	BlockNumber  uint64
	At           time.Time
	Status       string
	id           int64
}

// TransferPage is one page of transfers; NextCursor is "" on the last one.
type TransferPage struct {
	Items      []Transfer
	NextCursor string
}

// Transfers returns the page of the profile wallet's transfers after cursor ("" for the first), newest block time
// first. The caller has checked that the user owns the profile.
func (s *Service) Transfers(ctx context.Context, profileID, cursor string, limit int) (TransferPage, error) {
	if limit < 1 || limit > MaxLimit {
		return TransferPage{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
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
	rows, err := s.pool.Query(ctx, `
		SELECT t.id, t.chain_id, t.token_contract, tk.symbol, tk.decimals, t.direction, t.amount::text, t.counterparty,
		       t.tx_hash, t.log_index, t.block_number, t.block_time, t.status
		FROM wallet_transfers t
		JOIN profile_wallets w ON w.chain_family = t.chain_family AND w.address = t.wallet_address
		JOIN tokens tk ON tk.chain_id = t.chain_id AND tk.contract = t.token_contract
		WHERE w.profile_id = $1 AND t.status <> 'reorged'
		  AND ($2::bigint IS NULL OR (t.block_time, t.id) < ($2, $3))
		ORDER BY t.block_time DESC, t.id DESC LIMIT $4`, profileID, afterTime, afterID, limit+1)
	if err != nil {
		return TransferPage{}, fmt.Errorf("read wallet transfers: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Transfer, error) {
		var t Transfer
		var amount string
		var at int64
		err := row.Scan(&t.id, &t.ChainID, &t.Token, &t.Symbol, &t.Decimals, &t.Direction, &amount, &t.Counterparty,
			&t.TxHash, &t.LogIndex, &t.BlockNumber, &at, &t.Status)
		t.Amount, _ = new(big.Int).SetString(amount, 10)
		t.At = time.Unix(at, 0).UTC()
		return t, err
	})
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
