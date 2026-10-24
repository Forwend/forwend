package watcher

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/rpc"
)

// node forwards JSON-RPC to Anvil; hook may answer a single call itself (a non-empty result) or act before it is
// forwarded. Batches go straight through.
func node(t *testing.T, target string, hook func(method string) (result string)) *rpc.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		w.Header().Set("Content-Type", "application/json")
		if json.Unmarshal(body, &req) == nil {
			if result := hook(req.Method); result != "" {
				_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":` + string(req.ID) + `,"result":` + result + `}`))
				return
			}
		}
		res, err := http.Post(target, "application/json", bytes.NewReader(body))
		if err != nil {
			t.Error(err)
			return
		}
		defer res.Body.Close()
		_, _ = io.Copy(w, res.Body)
	}))
	t.Cleanup(srv.Close)
	c, err := rpc.Dial(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.Close)
	return c
}

func laggingNode(t *testing.T, target string, lag *atomic.Bool) *rpc.Client {
	return node(t, target, func(method string) string {
		if method == "eth_getLogs" && lag.Load() {
			return "[]"
		}
		return ""
	})
}

// Blocks mined between reading latest and finalized must not be skipped (Arc and Tempo finalize every block).
func TestChainMovingDuringAScanLosesNothing(t *testing.T) {
	e := setup(t)
	var once atomic.Bool
	e.chain = NewChain(e.pool, chaintest.ChainID, node(t, e.anvil.URL, func(method string) string {
		if method == "eth_getLogs" && once.CompareAndSwap(false, true) {
			e.anvil.Transfer(e.token, receive, "5000000")
			e.anvil.Mine(2 * RescanDepth)
		}
		return ""
	}))
	e.anvil.Mine(1)
	for range 3 {
		e.scan(t)
		e.anvil.Mine(1)
	}
	if _, n := e.rows(t); n != 1 {
		t.Fatalf("%d rows, want the deposit made during the first scan", n)
	}
}

func TestLaggingLatestBlockLosesNothing(t *testing.T) {
	e := setup(t)
	e.anvil.Transfer(e.token, receive, "5000000")
	var head hexutil.Uint64
	if err := e.anvil.RPC.Call(&head, "eth_blockNumber"); err != nil {
		t.Fatal(err)
	}
	e.anvil.Mine(2 * RescanDepth)
	var once atomic.Bool
	e.chain = NewChain(e.pool, chaintest.ChainID, node(t, e.anvil.URL, func(method string) string {
		if method == "eth_blockNumber" && once.CompareAndSwap(false, true) {
			return `"` + (head - 1).String() + `"`
		}
		return ""
	}))
	for range 3 {
		e.scan(t)
		e.anvil.Mine(1)
	}
	if _, n := e.rows(t); n != 1 {
		t.Fatalf("%d rows, want the deposit after a lagging latest block", n)
	}
}

func TestLaggingNodeDoesNotLoseADeposit(t *testing.T) {
	e := setup(t)
	var lag atomic.Bool
	e.chain = NewChain(e.pool, chaintest.ChainID, laggingNode(t, e.anvil.URL, &lag))
	tx := e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Mine(2) // already final when first scanned

	lag.Store(true)
	e.scan(t)
	lag.Store(false)
	e.scan(t)
	if got, n := e.rows(t); n != 1 || got[tx][0] != "confirmed" {
		t.Fatalf("after one empty answer: %v", got)
	}
}

func TestLaggingNodeDoesNotReorgADeposit(t *testing.T) {
	e := setup(t)
	var lag atomic.Bool
	e.chain = NewChain(e.pool, chaintest.ChainID, laggingNode(t, e.anvil.URL, &lag))
	tx := e.anvil.Transfer(e.token, receive, "5000000")
	e.scan(t)

	e.anvil.Mine(2)
	lag.Store(true)
	e.scan(t)
	if got, _ := e.rows(t); got[tx][0] != "detected" {
		t.Fatalf("after an empty answer: %v", got)
	}
	lag.Store(false)
	e.scan(t)
	if got, n := e.rows(t); n != 1 || got[tx][0] != "confirmed" {
		t.Fatalf("after a full answer: %v", got)
	}
}

// A -> B -> A: the chain returns to the first block; its row comes back and the B copy is reorged.
func TestReorgBackToTheFirstBlock(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	at := func(blockHash string) deposit {
		return deposit{invoiceID: "0x" + strings.Repeat("01", 32), token: e.token, txHash: "0x" + strings.Repeat("ab", 32),
			blockHash: blockHash, from: chaintest.Sender, to: receive, logIndex: 3, blockNumber: 100, blockTime: 1,
			amount: big.NewInt(5000000)}
	}
	a, b := at("0x"+strings.Repeat("aa", 32)), at("0x"+strings.Repeat("bb", 32))
	id := func(blockHash string) int64 {
		var id int64
		if err := e.pool.QueryRow(ctx, "SELECT id FROM chain_transfers WHERE block_hash = $1", blockHash).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	steps := []func() ([]int64, []deposit){
		func() ([]int64, []deposit) { return nil, []deposit{a} },
		func() ([]int64, []deposit) { return []int64{id(a.blockHash)}, []deposit{b} },
		func() ([]int64, []deposit) { return []int64{id(b.blockHash)}, []deposit{a} },
	}
	for i, step := range steps {
		reorged, deposits := step()
		if err := e.chain.record(ctx, reorged, deposits, nil, nil, header{Number: 50, Timestamp: 1}, header{Number: 200, Timestamp: 2}, nil); err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
	}
	var statusA, statusB string
	err := e.pool.QueryRow(ctx, `SELECT (SELECT status FROM chain_transfers WHERE block_hash = $1),
		(SELECT status FROM chain_transfers WHERE block_hash = $2)`, a.blockHash, b.blockHash).Scan(&statusA, &statusB)
	if err != nil || statusA != "detected" || statusB != "reorged" {
		t.Fatalf("A %s, B %s, %v; want A detected, B reorged", statusA, statusB, err)
	}
}
