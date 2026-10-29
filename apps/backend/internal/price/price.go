// Package price keeps CoinGecko's USD prices of the stablecoins (R-178, D-115). They are for display only: invoice
// amounts, the ledger, records and exports never read them (D-75, D-82).
package price

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// coinIDs maps a token symbol in the allowlist to its CoinGecko coin; a test token shows its mainnet coin's price
// (D-115). open-usd is Open USD, whose Tempo contract is our OUSD; origin-dollar is another coin also called OUSD.
var coinIDs = map[string]string{"USDC": "usd-coin", "USDT": "tether", "OUSD": "open-usd"}

// A price is stale when the worker read it over MaxFetchAge ago (four failed rounds), or CoinGecko last updated it
// over MaxSourceAge ago.
const (
	MaxFetchAge  = time.Hour
	MaxSourceAge = 24 * time.Hour
)

// Token is an enabled token's price. CoinID is "" for a symbol without a coin; USD and the times are empty without a
// price. Stale is also true without one.
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
		t.Stale = t.USD == "" || now.Sub(t.FetchedAt) > MaxFetchAge || now.Sub(t.SourceUpdatedAt) > MaxSourceAge
		return t, nil
	})
	if err != nil {
		return nil, fmt.Errorf("list prices: %w", err)
	}
	return list, nil
}
