package watcher

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/rpc"
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
	if logs != 1 {
		t.Fatalf("unchanged head used %d log queries, want only the invoice safety query", logs)
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
	if logs != 3 {
		t.Fatalf("pending heights used %d queries, want one invoice and two wallet queries", logs)
	}
}
