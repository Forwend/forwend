package price

import (
	"context"
	"reflect"
	"testing"
	"time"
)

// R-178, D-115: a test token takes its mainnet coin's price, a symbol without a coin has none, and a price turns
// stale; never 1 USD in its place.
func TestListGivesEachEnabledTokenItsCoinPrice(t *testing.T) {
	ctx := context.Background()
	pool := migrated(t)
	const usdc, ousd, eurc = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d", "0x20c0000000000000000000006a37da5c996874be",
		"0x1111111111111111111111111111111111111111"
	if _, err := pool.Exec(ctx, `
		WITH c AS (UPDATE chains SET enabled = true WHERE chain_id IN (421614, 42431))
		INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES (421614, 'evm', $1, 'EURC', 6, true), (5042002, 'evm', '0x2222222222222222222222222222222222222222', 'USDT', 6, true)`,
		eurc); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE tokens SET enabled = true WHERE chain_id IN (421614, 42431)"); err != nil {
		t.Fatal(err)
	}
	fetched := time.Date(2026, 10, 28, 10, 0, 0, 0, time.UTC)
	source := fetched.Add(-2 * time.Minute)
	k := &Keeper{Pool: pool}
	if err := k.store(ctx, []Coin{{"usd-coin", "0.999542", source}}, fetched); err != nil {
		t.Fatal(err)
	}

	list := func(at time.Time) []Token {
		t.Helper()
		got, err := List(ctx, pool, at)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	usdcAt := func(stale bool) Token {
		return Token{ChainID: 421614, Token: usdc, Symbol: "USDC", CoinID: "usd-coin", USD: "0.999542",
			SourceUpdatedAt: source, FetchedAt: fetched, Stale: stale}
	}
	// The disabled Arc chain's USDT is left out; OUSD has its coin but no price yet.
	want := []Token{{ChainID: 42431, Token: ousd, Symbol: "OUSD", CoinID: "open-usd", Stale: true},
		{ChainID: 421614, Token: eurc, Symbol: "EURC", Stale: true}, usdcAt(false)}
	if got := list(fetched.Add(MaxFetchAge)); !reflect.DeepEqual(got, want) {
		t.Fatalf("prices %+v", got)
	}
	want[2] = usdcAt(true)
	if got := list(fetched.Add(MaxFetchAge + time.Second)); !reflect.DeepEqual(got, want) {
		t.Fatalf("an old read is not stale: %+v", got)
	}

	// CoinGecko's own time counts too: a read just now of a price it last updated over a day ago is stale.
	source = fetched.Add(-MaxSourceAge - time.Second)
	if err := k.store(ctx, []Coin{{"usd-coin", "0.999542", source}}, fetched); err != nil {
		t.Fatal(err)
	}
	if got := list(fetched); !reflect.DeepEqual(got[2], usdcAt(true)) {
		t.Fatalf("an old source price is not stale: %+v", got[2])
	}
}
