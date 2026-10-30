package watcher

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

func proxiedChain(t *testing.T, e env) (*Chain, *chaintest.Proxy) {
	t.Helper()
	p := e.anvil.Proxy()
	client, err := rpc.Dial(p.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	return NewChain(e.pool, chaintest.ChainID, client), p
}

func TestFastScanDoesNotRepeatOldWalletLogsAndStillConfirmsPending(t *testing.T) {
	e := setup(t)
	addWallets(t, e.pool, ours)
	c, p := proxiedChain(t, e)
	ctx := context.Background()
	if err := c.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(e.token, ours, "5000000")
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	if rows := e.walletRows(t); len(rows) != 1 || !strings.HasSuffix(rows[0], "detected") {
		t.Fatalf("wallet deposit not detected: %v", rows)
	}
	e.anvil.Mine(2)
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	if rows := e.walletRows(t); len(rows) != 1 || !strings.HasSuffix(rows[0], "confirmed") {
		t.Fatalf("pending wallet deposit not confirmed: %v", rows)
	}
	before := len(p.Calls())
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	if err := c.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	logs := 0
	for _, call := range p.Calls()[before:] {
		if call.Method == "eth_getLogs" {
			logs++
		}
	}
	if logs != 2 {
		t.Fatalf("unchanged head used %d log queries, want only the invoice and receiver-event safety queries", logs)
	}
}

func TestRecoverySurvivesFastAdvanceFailureAndRestart(t *testing.T) {
	e := setup(t)
	addWallets(t, e.pool, ours)
	c, p := proxiedChain(t, e)
	ctx := context.Background()
	if err := c.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(e.token, ours, "5000000")
	e.anvil.Mine(2)
	p.Stale(func(call chaintest.Call) json.RawMessage {
		if call.Method == "eth_getLogs" {
			return json.RawMessage(`[]`)
		}
		return nil
	})
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	p.Stale(nil)
	e.anvil.Mine(6 * RescanDepth)
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	if rows := e.walletRows(t); len(rows) != 0 {
		t.Fatal("test did not hide the old deposit")
	}
	if _, err := e.pool.Exec(ctx, "UPDATE chain_recoveries SET next_at = now()"); err != nil {
		t.Fatal(err)
	}
	p.Fail(func(call chaintest.Call) chaintest.Fault {
		if call.Method == "eth_getLogs" {
			return chaintest.InternalError
		}
		return chaintest.Forward
	})
	if err := c.Recover(ctx); err == nil {
		t.Fatal("failed recovery was accepted")
	}
	var next, checkpoint, scanned uint64
	if err := e.pool.QueryRow(ctx, `SELECT next_block, completed_block, last_scanned_block FROM chain_recoveries JOIN chain_cursors USING (chain_id)`).Scan(&next, &checkpoint, &scanned); err != nil {
		t.Fatal(err)
	}
	if next > checkpoint {
		t.Fatalf("failed recovery advanced to %d past checkpoint %d", next, checkpoint)
	}
	restarted := NewChain(e.pool, chaintest.ChainID, e.anvil.RPC)
	if err := restarted.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	if rows := e.walletRows(t); len(rows) != 1 || !strings.HasSuffix(rows[0], "confirmed") {
		t.Fatalf("restart lost missed deposit: %v", rows)
	}
	var remaining *uint64
	if err := e.pool.QueryRow(ctx, "SELECT next_block FROM chain_recoveries").Scan(&remaining); err != nil || remaining == nil || *remaining != 5*MaxRange {
		t.Fatalf("partial recovery next %v (%v)", remaining, err)
	}
	addWallets(t, e.pool, outsider)
	if err := NewChain(e.pool, chaintest.ChainID, e.anvil.RPC).Recover(ctx); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(ctx, "SELECT next_block FROM chain_recoveries").Scan(&remaining); err != nil || remaining != nil {
		t.Fatalf("recovery did not finish: %v (%v)", remaining, err)
	}
	var after uint64
	if err := e.pool.QueryRow(ctx, "SELECT last_scanned_block FROM chain_cursors").Scan(&after); err != nil || after != scanned {
		t.Fatalf("recovery moved fast cursor %d to %d (%v)", scanned, after, err)
	}
}

func TestFastScanReorgsAndRecoveryFindsReplacement(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	c := e.chain
	if err := c.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	tx := e.anvil.Transfer(e.token, receive, "5000000")
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	e.anvil.Reorg(1)
	e.anvil.Mine(3)
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	if rows, _ := e.rows(t); rows[tx][0] != "reorged" {
		t.Fatalf("old deposit not reorged: %v", rows)
	}
}

func TestNewWalletTriggersRecoveryAndDisabledPendingTokenConfirms(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	if err := e.chain.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(e.token, ours, "1000000")
	if err := e.chain.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	addWallets(t, e.pool, ours)
	if err := e.chain.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	if rows := e.walletRows(t); len(rows) != 1 || !strings.HasSuffix(rows[0], "detected") {
		t.Fatalf("new wallet was not backfilled: %v", rows)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE tokens SET enabled = false WHERE chain_id = $1", chaintest.ChainID); err != nil {
		t.Fatal(err)
	}
	e.anvil.Mine(2)
	if err := e.chain.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	if rows := e.walletRows(t); len(rows) != 1 || !strings.HasSuffix(rows[0], "confirmed") {
		t.Fatalf("disabled pending transfer did not confirm: %v", rows)
	}
}

func TestPendingWalletHeightsShareLogRanges(t *testing.T) {
	e := setup(t)
	addWallets(t, e.pool, ours)
	c, p := proxiedChain(t, e)
	ctx := context.Background()
	for range 5 {
		e.anvil.Transfer(e.token, ours, "1")
	}
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	before := len(p.Calls())
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	logs := 0
	for _, call := range p.Calls()[before:] {
		if call.Method == "eth_getLogs" {
			logs++
		}
	}
	if logs != 4 {
		t.Fatalf("pending heights used %d queries, want one invoice, one receiver-event and two wallet queries", logs)
	}
}

// prunedBelow answers every log query starting below block first as a node that keeps no older history.
func prunedBelow(first uint64) func(chaintest.Call) chaintest.Fault {
	return func(call chaintest.Call) chaintest.Fault {
		var filter struct{ FromBlock hexutil.Uint64 }
		if call.Method == "eth_getLogs" && json.Unmarshal(call.Params[0], &filter) == nil && uint64(filter.FromBlock) < first {
			return chaintest.Pruned
		}
		return chaintest.Forward
	}
}

// History no RPC keeps can't be read again; the sweep moves to the oldest kept block instead of stalling on it (R-191).
func TestRecoveryMovesPastHistoryNoRPCKeeps(t *testing.T) {
	e := setup(t)
	c, p := proxiedChain(t, e)
	ctx := context.Background()
	e.anvil.Mine(200)
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	if err := c.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	latest, err := c.eth.BlockNumber(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE chain_recoveries SET next_block = 1, target_block = $1", latest); err != nil {
		t.Fatal(err)
	}
	// Even the finalized block missing is no pruning (lagging or broken nodes): the sweep waits.
	p.Fail(prunedBelow(1 << 40))
	if err := c.Recover(ctx); err == nil {
		t.Fatal("a sweep whose every block is missing moved on")
	}
	var waited uint64
	if err := e.pool.QueryRow(ctx, "SELECT next_block FROM chain_recoveries").Scan(&waited); err != nil || waited != 1 {
		t.Fatalf("next block %d (%v), want it kept at 1", waited, err)
	}
	p.Fail(prunedBelow(50))
	var logs strings.Builder
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	if err := c.Recover(ctx); err != nil {
		t.Fatalf("recovery over pruned history: %v", err)
	}
	var next uint64
	if err := e.pool.QueryRow(ctx, "SELECT next_block FROM chain_recoveries").Scan(&next); err != nil || next != 50 {
		t.Fatalf("next block %d (%v), want 50, the oldest one kept", next, err)
	}
	if !strings.Contains(logs.String(), "ALERT recovery skips blocks no RPC keeps any more") || !strings.Contains(logs.String(), "to=49") {
		t.Fatalf("logs lack the skipped range:\n%s", logs.String())
	}
	if err := c.Recover(ctx); err != nil {
		t.Fatalf("recovery after the pruned blocks: %v", err)
	}
}

// pruned moves past blocks only when they are below the finalized block, that one is served, and the start is not.
func TestPrunedFindsOnlyHistoryNoRPCKeeps(t *testing.T) {
	e := setup(t)
	c, p := proxiedChain(t, e)
	ctx := context.Background()
	e.anvil.Mine(100)
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	var finalized uint64
	if err := e.pool.QueryRow(ctx, "SELECT last_finalized_block FROM chain_cursors").Scan(&finalized); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := c.pruned(ctx, 1); ok || err != nil {
		t.Fatalf("every block served: ok %v (%v), want no pruning", ok, err)
	}
	// A node missing blocks above the finalized one lags; it hasn't pruned them.
	p.Fail(func(call chaintest.Call) chaintest.Fault {
		var filter struct{ FromBlock hexutil.Uint64 }
		if call.Method == "eth_getLogs" && json.Unmarshal(call.Params[0], &filter) == nil && uint64(filter.FromBlock) > finalized {
			return chaintest.Pruned
		}
		return chaintest.Forward
	})
	if _, ok, err := c.pruned(ctx, finalized+1); ok || err != nil {
		t.Fatalf("missing above the finalized block: ok %v (%v), want no pruning", ok, err)
	}
	p.Fail(prunedBelow(40))
	if kept, ok, err := c.pruned(ctx, 1); !ok || err != nil || kept != 40 {
		t.Fatalf("pruned below 40: kept %d ok %v (%v)", kept, ok, err)
	}
}

// One endpoint pruned and another down is no proof that no endpoint keeps the blocks: the sweep waits.
func TestRecoveryWaitsWhenAnEndpointThatMayKeepHistoryIsDown(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	pruning := e.anvil.Proxy()
	down := httptest.NewServer(http.NotFoundHandler())
	down.Close()
	r, err := chain.NewRPCs(chain.Spec{ChainID: chaintest.ChainID, AllowLoopback: true, Endpoints: []chain.Endpoint{
		{ID: "rpc-0", Provider: "provider-0", Role: chain.Primary, Tier: chain.Public, URL: pruning.URL, BudgetGroup: "budget-0"},
		{ID: "rpc-1", Provider: "provider-1", Role: chain.Primary, Tier: chain.Public, URL: strings.Replace(down.URL, "127.0.0.1", "localhost", 1), BudgetGroup: "budget-1"},
	}}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Close)
	c := NewChain(e.pool, chaintest.ChainID, r.Client)
	e.anvil.Mine(200)
	if err := c.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	if err := c.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	latest, err := c.eth.BlockNumber(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE chain_recoveries SET next_block = 1, target_block = $1", latest); err != nil {
		t.Fatal(err)
	}
	pruning.Fail(prunedBelow(50))
	if err := c.Recover(ctx); err == nil {
		t.Fatal("a sweep moved past blocks an endpoint that is down may keep")
	}
	var next uint64
	if err := e.pool.QueryRow(ctx, "SELECT next_block FROM chain_recoveries").Scan(&next); err != nil || next != 1 {
		t.Fatalf("next block %d (%v), want it kept at 1", next, err)
	}
}
