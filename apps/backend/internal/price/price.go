// Package price keeps CoinGecko's USD prices of the stablecoins, for display only: money code never reads them.
package price

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// coinIDs maps an allowlist symbol to its CoinGecko coin; open-usd is our Tempo OUSD, origin-dollar is another.
var coinIDs = map[string]string{"USDC": "usd-coin", "USDT": "tether", "OUSD": "open-usd"}

// A price is stale when read over maxFetchAge ago (four failed rounds) or updated at CoinGecko over maxSourceAge ago.
const (
	maxFetchAge  = time.Hour
	maxSourceAge = 24 * time.Hour
)

// Token is an enabled token's price; CoinID is "" without a coin; without a price the rest is empty and Stale true.
type Token struct {
	ChainID         uint64
	Token           string
	Symbol          string
	CoinID          string
	USD             string
	SourceUpdatedAt time.Time
	FetchedAt       time.Time
	Stale           bool
}

// List gives every enabled token, by chain id, with its coin's price as kept at now.
func List(ctx context.Context, pool *pgxpool.Pool, now time.Time) ([]Token, error) {
	symbols, coins := make([]string, 0, len(coinIDs)), make([]string, 0, len(coinIDs))
	for symbol, coin := range coinIDs {
		symbols, coins = append(symbols, symbol), append(coins, coin)
	}
	rows, err := pool.Query(ctx, `SELECT t.chain_id, t.contract, t.symbol, coalesce(m.coin_id, ''),
		    coalesce(p.usd::text, ''), p.source_updated_at, p.fetched_at
		FROM tokens t JOIN chains c ON c.chain_id = t.chain_id
		LEFT JOIN unnest($1::text[], $2::text[]) AS m (symbol, coin_id) ON m.symbol = t.symbol
		LEFT JOIN coin_prices p ON p.coin_id = m.coin_id
		WHERE t.enabled AND c.enabled ORDER BY t.chain_id, t.symbol, t.contract`, symbols, coins)
	if err != nil {
		return nil, fmt.Errorf("list prices: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Token, error) {
		var t Token
		var source, fetched *time.Time
		if err := row.Scan(&t.ChainID, &t.Token, &t.Symbol, &t.CoinID, &t.USD, &source, &fetched); err != nil {
			return t, err
		}
		if t.USD != "" {
			t.SourceUpdatedAt, t.FetchedAt = source.UTC(), fetched.UTC()
		}
		t.Stale = t.USD == "" || now.Sub(t.FetchedAt) > maxFetchAge || now.Sub(t.SourceUpdatedAt) > maxSourceAge
		return t, nil
	})
	if err != nil {
		return nil, fmt.Errorf("list prices: %w", err)
	}
	return list, nil
}
