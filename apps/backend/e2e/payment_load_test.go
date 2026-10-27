//go:build e2e && loadtest

package e2e

import (
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

func TestPaymentLoad(t *testing.T) {
	st := newStack(t, "API_USER_BURST=10000")
	st.limited.Fail(nil)
	second := st.anvil.Proxy()
	configureRPCs(t, st.db, st.limited.URL, strings.Replace(second.URL, "127.0.0.1", "localhost", 1))
	rate := "100000"
	if configured := os.Getenv("F336_RPC_RATE"); configured != "" {
		rate = configured
	}
	loop := append([]string{}, st.loop...)
	for i, v := range loop {
		if strings.HasPrefix(v, "RPC_RATE_PER_SECOND=") {
			loop[i] = "RPC_RATE_PER_SECOND=" + rate
		}
	}
	workerDir, workerName := st.bin, "worker"
	if binary := os.Getenv("F336_WORKER_BINARY"); binary != "" {
		workerDir, workerName = filepath.Dir(binary), filepath.Base(binary)
	}
	// A saved cursor lets orders be created before the timed worker run.
	var block hexutil.Uint64
	if err := st.anvil.RPC.CallContext(t.Context(), &block, "eth_blockNumber"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.conn.Exec(t.Context(), `INSERT INTO chain_cursors(chain_id,last_scanned_block,last_finalized_block,last_scanned_time,last_finalized_time) VALUES($1,$2,$2,$3,$3)`, chaintest.ChainID, block-2, st.anvil.Now()-2); err != nil {
		t.Fatal(err)
	}
	count := 200
	if configured := os.Getenv("F336_LOAD_COUNT"); configured != "" {
		var err error
		count, err = strconv.Atoi(configured)
		if err != nil || count <= 0 || count > 1000 || count%20 != 0 {
			t.Fatal("F336_LOAD_COUNT must be a positive multiple of20, at most1000")
		}
	}
	addresses := make([]string, count)
	began := time.Now()
	for offset := 0; offset < count; offset += 20 {
		var group sync.WaitGroup
		for i := offset; i < offset+20; i++ {
			group.Go(func() {
				status, created := post(t, st.api+"/v1/profiles/"+st.profile+"/invoices", st.privy, fmt.Sprintf("payment-load-%d", i), fmt.Sprintf(`{"chainId":%d,"token":%q,"amount":"1000000"}`, chaintest.ChainID, st.token))
				if status != 201 {
					t.Errorf("create %d: HTTP %d", i, status)
					return
				}
				addresses[i], _ = created["receiveAddress"].(string)
			})
		}
		group.Wait()
	}
	createElapsed := time.Since(began)
	if t.Failed() {
		return
	}
	var nonce hexutil.Uint64
	if err := st.anvil.RPC.CallContext(t.Context(), &nonce, "eth_getTransactionCount", chaintest.Sender, "pending"); err != nil {
		t.Fatal(err)
	}
	var batch []rpc.BatchElem
	hashes := make([]string, count)
	for i, addr := range addresses {
		data := append(crypto.Keccak256([]byte("transfer(address,uint256)"))[:4], common.LeftPadBytes(common.HexToAddress(addr).Bytes(), 32)...)
		data = append(data, common.LeftPadBytes(big.NewInt(1000000).Bytes(), 32)...)
		batch = append(batch, rpc.BatchElem{Method: "eth_sendTransaction", Args: []any{map[string]any{"from": chaintest.Sender, "to": st.token, "data": hexutil.Encode(data), "gas": "0x186a0", "nonce": hexutil.EncodeUint64(uint64(nonce) + uint64(i))}}, Result: &hashes[i]})
	}
	for i := 0; i < count; i += 20 {
		if err := st.anvil.RPC.BatchCallContext(t.Context(), batch[i:i+20]); err != nil {
			t.Fatal(err)
		}
	}
	for _, call := range batch {
		if call.Error != nil {
			t.Fatal(call.Error)
		}
	}
	waitFor(t, "all load transfers mined", func() bool {
		var receipts []rpc.BatchElem
		results := make([]*struct {
			BlockNumber string `json:"blockNumber"`
		}, len(hashes))
		for i, hash := range hashes {
			receipts = append(receipts, rpc.BatchElem{Method: "eth_getTransactionReceipt", Args: []any{hash}, Result: &results[i]})
		}
		if err := st.anvil.RPC.BatchCallContext(t.Context(), receipts); err != nil {
			t.Fatal(err)
		}
		for i, result := range results {
			if receipts[i].Error != nil {
				t.Fatal(receipts[i].Error)
			}
			if result == nil {
				st.anvil.Mine(1)
				return false
			}
		}
		return true
	})
	st.anvil.Mine(2)
	before := len(st.limited.Calls())
	beforeSecond := len(second.Calls())
	began = time.Now()
	start(t, workerDir, workerName, loop)
	paid := 0
	var first, p50, p95 time.Duration
	deadline := time.Now().Add(5 * time.Minute)
	for paid < count && time.Now().Before(deadline) {
		if err := st.conn.QueryRow(t.Context(), "SELECT count(*) FROM invoices WHERE payment_status='paid'").Scan(&paid); err != nil {
			t.Fatal(err)
		}
		elapsed := time.Since(began)
		if paid > 0 && first == 0 {
			first = elapsed
		}
		if paid >= count/2 && p50 == 0 {
			p50 = elapsed
		}
		if paid >= count*95/100 && p95 == 0 {
			p95 = elapsed
		}
		if paid < count {
			time.Sleep(100 * time.Millisecond)
		}
	}
	elapsed := time.Since(began)
	calls := append(st.limited.Calls()[before:], second.Calls()[beforeSecond:]...)
	logical, logs := 0, 0
	for _, call := range calls {
		logical += len(call.Methods)
		for _, method := range call.Methods {
			if method == "eth_getLogs" {
				logs++
			}
		}
	}
	t.Logf("create: n=%d elapsed=%s rate=%.1f orders/s; payment: paid=%d/%d elapsed=%s rate=%.1f/s first=%s p50=%s p95=%s HTTP=%d RPC=%d logs=%d configuredRPCrate=%s", count, createElapsed, float64(count)/createElapsed.Seconds(), paid, count, elapsed, float64(paid)/elapsed.Seconds(), first, p50, p95, len(calls), logical, logs, rate)
	if paid != count {
		t.Errorf("payment backlog remains: %d", count-paid)
	}
}
