package intents_test

import (
	"context"
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
	if err := keeper.Tick(ctx, start.Add(intents.TokensEvery-time.Second)); err != nil {
		t.Fatal(err)
	}
	if list, _ := intents.List(ctx, pool); len(list) != 4 {
		t.Fatalf("read before it was due: %+v", list)
	}
	// A failed read keeps the last list and tries again 2 minutes later.
	fake.Down = true
	if err := keeper.Tick(ctx, start.Add(intents.TokensEvery)); err == nil {
		t.Fatal("a failed read reported no error")
	}
	fake.Down = false
	if err := keeper.Tick(ctx, start.Add(intents.TokensEvery+time.Minute)); err != nil {
		t.Fatal(err)
	}
	if list, _ := intents.List(ctx, pool); len(list) != 4 {
		t.Fatalf("read again before the retry: %+v", list)
	}
	if err := keeper.Tick(ctx, start.Add(intents.TokensEvery+2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if list, _ := intents.List(ctx, pool); len(list) != 1 || list[0].AssetID != intents.BaseUSDCAsset {
		t.Fatalf("after 1Click dropped tokens: %+v", list)
	}
}
