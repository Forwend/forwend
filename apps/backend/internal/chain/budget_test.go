package chain

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
)

func TestRPCBudgetIsSharedAcrossProcessesAndChainHosts(t *testing.T) {
	ctx := context.Background()
	url := databasetest.Migrated(t, database.Migrate)
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	first, err := NewBudget(ctx, db, 10, MoneyShare)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := NewBudget(ctx, db, 10, MoneyShare)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	base, arb := "shared-account", "shared-account"
	start := time.Now()
	if err := first.wait(ctx, base, []byte(`{"method":"eth_getLogs"}`)); err != nil {
		t.Fatal(err)
	}
	if err := second.wait(ctx, arb, []byte(`[{"method":"eth_call"},{"method":"eth_call"}]`)); err != nil {
		t.Fatal(err)
	}
	if err := first.wait(ctx, base, []byte(`{"method":"eth_chainId"}`)); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed < 500*time.Millisecond {
		t.Fatalf("weighted reads took %v, want >= 500ms", elapsed)
	}
	var bucket string
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*), min(bucket) FROM rpc_budgets").Scan(&count, &bucket); err != nil {
		t.Fatal(err)
	}
	if count != 1 || strings.Contains(bucket, "secret") || len(bucket) != 64 {
		t.Fatalf("stored %d buckets with unsafe key %q", count, bucket)
	}
	if _, err := db.Exec(ctx, "UPDATE rpc_budgets SET next_at = now() + interval '1 minute'"); err != nil {
		t.Fatal(err)
	}
	short, cancel := context.WithTimeout(ctx, 20*time.Millisecond)
	defer cancel()
	if err := second.wait(short, base, []byte(`{"method":"eth_call"}`)); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("full budget returned %v, want deadline", err)
	}
	if budgetKey(base) == budgetKey("other-account") {
		t.Fatal("different budget groups share a bucket")
	}
	a := chaintest.Start(t)
	proxy := a.Proxy()
	r, err := NewRPCs(testSpec(chaintest.ChainID, proxy.URL, a.URL), 1000, first)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if _, err := db.Exec(ctx, "DROP TABLE rpc_budgets"); err != nil {
		t.Fatal(err)
	}
	if _, err := tryNumber(ctx, r.Client); err == nil {
		t.Fatal("database failure bypassed the shared budget")
	}
	if len(proxy.Calls()) != 0 {
		t.Fatal("database failure still sent an RPC request")
	}
	if failures, _ := health(r, r.pool.endpoints[0]); failures != 0 {
		t.Fatal("budget failure marked the provider unhealthy")
	}
}

func TestAPIReadsCannotTakeTheMoneyPathsBudget(t *testing.T) {
	ctx := context.Background()
	url := databasetest.Migrated(t, database.Migrate)
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	api, err := NewBudget(ctx, db, 10, APIShare)
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	money, err := NewBudget(ctx, db, 10, MoneyShare)
	if err != nil {
		t.Fatal(err)
	}
	defer money.Close()
	// One block-receipts read fills the api's 160 units a second for over 6 s.
	if err := api.wait(ctx, "shared-account", []byte(`{"method":"eth_getBlockReceipts"}`)); err != nil {
		t.Fatal(err)
	}
	short, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	if err := api.wait(short, "shared-account", []byte(`{"method":"eth_call"}`)); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("api past its share returned %v, want deadline", err)
	}
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	start := time.Now()
	if err := money.wait(bounded, "shared-account", []byte(`{"method":"eth_getLogs"}`)); err != nil {
		t.Fatalf("worker read behind a full api share: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 200*time.Millisecond {
		t.Fatalf("worker read waited %v behind the api", elapsed)
	}
}
