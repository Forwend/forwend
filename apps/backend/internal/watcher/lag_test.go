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
	"github.com/ethereum/go-ethereum/rpc"
)

// laggingNode forwards to Anvil but answers eth_getLogs with [] while lag is set: a load-balanced node that is behind.
func laggingNode(t *testing.T, target string, lag *atomic.Bool) *rpc.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		w.Header().Set("Content-Type", "application/json")
		if json.Unmarshal(body, &req) == nil && req.Method == "eth_getLogs" && lag.Load() {
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":` + string(req.ID) + `,"result":[]}`))
			return
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

// An empty eth_getLogs answer in the scan where the deposit's block becomes final doesn't lose the deposit.
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

// An empty eth_getLogs answer doesn't reorg a detected deposit whose block is still on the chain.
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
		if err := e.chain.record(ctx, reorged, deposits, 50, 200); err != nil {
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
