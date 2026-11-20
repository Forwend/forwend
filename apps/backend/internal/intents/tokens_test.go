package intents_test

import (
	"context"
	"errors"
	"math/big"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/forwend/forwend/apps/backend/internal/intents/intentstest"
)

func TestKeeperKeepsTheListAndDropsWhat1ClickDropped(t *testing.T) {
	ctx := context.Background()
	pool, err := database.Open(ctx, databasetest.Migrated(t, database.Migrate))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	fake := intentstest.New(t)
	tron := intentstest.Tokens[2]
	fake.Tokens = []map[string]any{
		intentstest.Tokens[0], tron, tron,
		{"assetId": "nep141:eth.omft.near", "blockchain": "eth", "symbol": "ETH", "decimals": 18, "price": nil},
		{"assetId": "nep141:tiny.omft.near", "blockchain": "eth", "symbol": "TINY", "decimals": 18, "price": 1.9e-7},
	}
	keeper := &intents.Keeper{Pool: pool, Client: fake.Client(), Every: intents.TokensEvery}
	every := 10 * time.Minute
	start := time.Now()
	if err := keeper.Tick(ctx, start); err != nil {
		t.Fatal(err)
	}
	list, err := intents.List(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]intents.Token{}
	for _, tok := range list {
		got[tok.AssetID] = tok
	}
	if len(list) != 4 || got[tron["assetId"].(string)].Contract != "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" ||
		got["nep141:eth.omft.near"].USD != "" || got["nep141:tiny.omft.near"].USD != "0.00000019" ||
		list[0].Symbol != "USDC" || list[1].Symbol != "USDT" {
		t.Fatalf("list %+v", list)
	}

	fake.Tokens = []map[string]any{intentstest.Tokens[0]}
	if err := keeper.Tick(ctx, start.Add(every-time.Second)); err != nil {
		t.Fatal(err)
	}
	if list, _ := intents.List(ctx, pool); len(list) != 4 {
		t.Fatalf("read before it was due: %+v", list)
	}
	fake.Down = true
	if err := keeper.Tick(ctx, start.Add(every)); err == nil {
		t.Fatal("a failed read reported no error")
	}
	fake.Down = false
	if err := keeper.Tick(ctx, start.Add(every+time.Minute)); err != nil {
		t.Fatal(err)
	}
	if list, _ := intents.List(ctx, pool); len(list) != 4 {
		t.Fatalf("read again before the retry: %+v", list)
	}
	if err := keeper.Tick(ctx, start.Add(every+2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if list, _ := intents.List(ctx, pool); len(list) != 1 || list[0].AssetID != intents.BaseUSDCAsset {
		t.Fatalf("after 1Click dropped tokens: %+v", list)
	}
}

func TestTokensLeaveOutWhat1ClickMarksDeprecated(t *testing.T) {
	fake := intentstest.New(t)
	fake.Tokens = nil
	for asset, symbol := range map[string]string{"live": "USDC", "old": "USDC(DEPRECATED)", "underscore": "XPL_(DEPRECATED)",
		"lower": "avax(deprecated)", "omni": "BTC(OMNI)"} {
		fake.Tokens = append(fake.Tokens, map[string]any{"assetId": asset, "blockchain": "eth", "symbol": symbol,
			"decimals": 6, "price": 1})
	}
	list, err := fake.Client().Tokens(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, tok := range list {
		got = append(got, tok.AssetID)
	}
	slices.Sort(got)
	if !slices.Equal(got, []string{"live", "omni"}) {
		t.Fatalf("kept %v, want the live USDC and BTC(OMNI) only", got)
	}
}

func TestKeeperKeepsOnlyAPlainCoingeckoID(t *testing.T) {
	ctx := context.Background()
	pool, err := database.Open(ctx, databasetest.Migrated(t, database.Migrate))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	fake := intentstest.New(t)
	given := map[string]any{"usd-coin": "usd-coin", "aster-2": "aster-2", "custom": "custom:qtc", "capital": "Usd-Coin",
		"path": "../ping", "query": "tether?x=1", "empty": "", "long": strings.Repeat("a", 65), "number": 7, "null": nil}
	want := map[string]string{"usd-coin": "usd-coin", "aster-2": "aster-2"}
	fake.Tokens = []map[string]any{{"assetId": "missing", "blockchain": "eth", "symbol": "T", "decimals": 6, "price": 1}}
	for asset, id := range given {
		fake.Tokens = append(fake.Tokens, map[string]any{"assetId": asset, "blockchain": "eth", "symbol": "T", "decimals": 6,
			"price": 1, "coingeckoId": id})
	}
	keeper := &intents.Keeper{Pool: pool, Client: fake.Client(), Every: intents.TokensEvery}
	start := time.Now()
	kept := func() map[string]string {
		t.Helper()
		list, err := intents.List(ctx, pool)
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]string{}
		for _, tok := range list {
			got[tok.AssetID] = tok.CoingeckoID
		}
		return got
	}
	if err := keeper.Tick(ctx, start); err != nil {
		t.Fatal(err)
	}
	got := kept()
	if len(got) != len(given)+1 {
		t.Fatalf("%d tokens, want %d: an id that is no plain one loses the token nothing else", len(got), len(given)+1)
	}
	for asset, id := range got {
		if id != want[asset] {
			t.Errorf("%s: id %q, want %q", asset, id, want[asset])
		}
	}

	fake.Tokens = []map[string]any{
		{"assetId": "usd-coin", "blockchain": "eth", "symbol": "T", "decimals": 6, "price": 1},
		{"assetId": "aster-2", "blockchain": "eth", "symbol": "T", "decimals": 6, "price": 1, "coingeckoId": "aster"},
	}
	if err := keeper.Tick(ctx, start.Add(intents.TokensEvery)); err != nil {
		t.Fatal(err)
	}
	if got := kept(); len(got) != 2 || got["usd-coin"] != "" || got["aster-2"] != "aster" {
		t.Fatalf("after 1Click changed the ids: %v", got)
	}
}

func TestKeeperProbesEachTokensMinimum(t *testing.T) {
	ctx := context.Background()
	pool, err := database.Open(ctx, databasetest.Migrated(t, database.Migrate))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	fake := intentstest.New(t)
	arb := intentstest.Tokens[1]["assetId"].(string)
	tron, eth := intentstest.Tokens[2]["assetId"].(string), intentstest.Tokens[3]["assetId"].(string)
	fake.Limits = map[string]int64{tron: 1000}
	keeper := &intents.Keeper{Pool: pool, Client: fake.Client(), Every: intents.TokensEvery}
	start := time.Now()
	if err := keeper.Tick(ctx, start); err != nil {
		t.Fatal(err)
	}
	minimums := func() map[string]string {
		t.Helper()
		list, err := intents.List(ctx, pool)
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]string{}
		for _, tok := range list {
			got[tok.AssetID] = tok.Minimum
		}
		return got
	}
	checkedSince := func(at time.Time) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM intents_tokens WHERE minimum_checked_at >= $1", at).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	sweep := func(at time.Time, n int) {
		t.Helper()
		for i := range n {
			if err := keeper.Probe(ctx, at.Add(time.Duration(i)*5*time.Second)); err != nil {
				t.Fatal(err)
			}
		}
	}
	sweep(start, 1)
	if err := keeper.Probe(ctx, start); err != nil || checkedSince(start) != 1 {
		t.Fatalf("a second probe at once: err %v, checked %d, want 1", err, checkedSince(start))
	}
	sweep(start.Add(5*time.Second), 5)
	if n := checkedSince(start); n != 3 {
		t.Fatalf("checked %d, want 3", n)
	}
	if n := fake.QuoteCount(); n != 3 {
		t.Fatalf("quotes %d, want 3", n)
	}
	if got := minimums(); got[tron] != "1000000000" || got[eth] != "" || got[arb] != "" {
		t.Fatalf("minimums %v", got)
	}
	sweep(start.Add(30*time.Minute), 3)
	if n := checkedSince(start.Add(30 * time.Minute)); n != 0 {
		t.Fatalf("checked %d within the hour, want 0", n)
	}
	fake.Minimum = big.NewInt(4_800_000)
	sweep(start.Add(time.Hour), 3)
	if got := minimums(); got[tron] != "1000000000" || got[eth] != "4800000" || got[arb] != "4800000" {
		t.Fatalf("minimums an hour on %v", got)
	}
	fake.Minimum, fake.Limits, fake.Refuse = big.NewInt(5301), nil, map[string]bool{arb: true}
	refused := 0
	for i := range 3 {
		if err := keeper.Probe(ctx, start.Add(2*time.Hour+time.Duration(i)*5*time.Second)); err != nil {
			if !errors.Is(err, intents.ErrRefused) {
				t.Fatal(err)
			}
			refused++
		}
	}
	got := minimums()
	if refused != 1 || checkedSince(start.Add(2*time.Hour)) != 3 || got[tron] != "" || got[eth] != "" || got[arb] != "4800000" {
		t.Fatalf("refused %d, checked %d, minimums %v", refused, checkedSince(start.Add(2*time.Hour)), got)
	}
	fake.Minimum, fake.Refuse = big.NewInt(6_000_000), map[string]bool{eth: true}
	refused = 0
	for i := range 3 {
		if err := keeper.Probe(ctx, start.Add(3*time.Hour+time.Duration(i)*5*time.Second)); err != nil {
			if !errors.Is(err, intents.ErrRefused) {
				t.Fatal(err)
			}
			refused++
		}
	}
	if got := minimums(); refused != 1 || got[eth] != "6000000" {
		t.Fatalf("refused %d, minimums after a later refusal %v", refused, got)
	}
	fake.Minimum, fake.Refuse = big.NewInt(5301), nil
	fake.Down = true
	at := start.Add(4 * time.Hour)
	if err := keeper.Probe(ctx, at); err == nil {
		t.Fatal("probe while 1Click is down: no error")
	}
	sweep(at.Add(5*time.Second), 1)
	fake.Down = false
	fake.Tamper = func(answer map[string]any) {
		if req := answer["quoteRequest"].(map[string]any); req["originAsset"] == arb {
			req["recipient"] = "0x0000000000000000000000000000000000000001"
		}
	}
	at = start.Add(5 * time.Hour)
	for i := range 6 {
		_ = keeper.Probe(ctx, at.Add(time.Duration(i)*2*time.Minute))
	}
	if n := checkedSince(at); n != 3 {
		t.Fatalf("checked %d with one bad token, want 3", n)
	}
}
