package intents_test

import (
	"context"
	"math/big"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/forwend/forwend/apps/backend/internal/intents/intentstest"
)

// R-232: the worker keeps 1Click's list as 1Click gives it, every TokensEvery, and 2 minutes after a failed read.
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
		intentstest.Tokens[0], tron, tron, // listed twice: kept once
		{"assetId": "nep141:eth.omft.near", "blockchain": "eth", "symbol": "ETH", "decimals": 18, "price": nil},
		{"assetId": "nep141:tiny.omft.near", "blockchain": "eth", "symbol": "TINY", "decimals": 18, "price": 1.9e-7},
	}
	keeper := &intents.Keeper{Pool: pool, Client: fake.Client(), Every: intents.TokensEvery}
	every := 10 * time.Minute // R-232
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
	// Tron's contract keeps its case: it is another address in another one.
	if len(list) != 4 || got[tron["assetId"].(string)].Contract != "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" ||
		got["nep141:eth.omft.near"].USD != "" || got["nep141:tiny.omft.near"].USD != "0.00000019" ||
		list[0].Symbol != "USDC" || list[1].Symbol != "USDT" {
		t.Fatalf("list %+v", list)
	}

	// Not due yet: nothing is read, so the dropped token is still there.
	fake.Tokens = []map[string]any{intentstest.Tokens[0]}
	if err := keeper.Tick(ctx, start.Add(every-time.Second)); err != nil {
		t.Fatal(err)
	}
	if list, _ := intents.List(ctx, pool); len(list) != 4 {
		t.Fatalf("read before it was due: %+v", list)
	}
	// A failed read keeps the last list and tries again 2 minutes later.
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

// D-126: the worker learns each offered token's minimum, one dry quote at a time, from both ways 1Click names one.
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
	fake.Limits = map[string]int64{tron: 1000} // "Temporary swap limits: minimum swap amount is $1,000"
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
	// Probes 5 seconds apart from at; each must succeed.
	sweep := func(at time.Time, n int) {
		t.Helper()
		for i := range n {
			if err := keeper.Probe(ctx, at.Add(time.Duration(i)*5*time.Second)); err != nil {
				t.Fatal(err)
			}
		}
	}
	// One every 5 seconds: a second probe at once asks nothing.
	sweep(start, 1)
	if err := keeper.Probe(ctx, start); err != nil || checkedSince(start) != 1 {
		t.Fatalf("a second probe at once: err %v, checked %d, want 1", err, checkedSince(start))
	}
	// Base USDC, Stellar (a memo chain) and unpriced SOL are never offered, so never checked: 3 tokens in all.
	sweep(start.Add(5*time.Second), 5)
	if n := checkedSince(start); n != 3 {
		t.Fatalf("checked %d, want 3", n)
	}
	if got := minimums(); got[tron] != "1000000000" || got[eth] != "" || got[arb] != "" {
		t.Fatalf("minimums %v", got)
	}
	// Each token waits an hour before it is checked again.
	sweep(start.Add(30*time.Minute), 3)
	if n := checkedSince(start.Add(30 * time.Minute)); n != 0 {
		t.Fatalf("checked %d within the hour, want 0", n)
	}
	// "try at least" names it in Base USDC units. Behind a bridge's least of 4.8 USDC, Tron's dollar limit is kept.
	fake.Minimum = big.NewInt(4_800_000)
	sweep(start.Add(time.Hour), 3)
	if got := minimums(); got[tron] != "1000000000" || got[eth] != "4800000" || got[arb] != "4800000" {
		t.Fatalf("minimums an hour on %v", got)
	}
	// Limits lifted clear them; a refusal for another reason names none, and the next token follows 5 seconds later.
	fake.Minimum, fake.Limits, fake.Refuse = big.NewInt(5301), nil, map[string]bool{arb: true}
	sweep(start.Add(2*time.Hour), 3)
	if got := minimums(); got[tron] != "" || got[eth] != "" || got[arb] != "" {
		t.Fatalf("minimums once lifted %v", got)
	}
	// 1Click unreachable: it waits 2 minutes, and the token keeps its minimum.
	fake.Refuse = nil
	if err := keeper.Probe(ctx, start.Add(3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	fake.Down = true
	at := start.Add(4 * time.Hour)
	if err := keeper.Probe(ctx, at); err == nil {
		t.Fatal("probe while 1Click is down: no error")
	}
	sweep(at.Add(5*time.Second), 1) // waiting: asks nothing, so no error
	// One token whose answers fail their checks can't hold up the rest.
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
