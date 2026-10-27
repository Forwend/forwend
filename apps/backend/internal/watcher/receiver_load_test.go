package watcher

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

func TestReceiverIdleRequestVolume(t *testing.T) {
	e := setup(t)
	proxy := e.anvil.Proxy()
	client, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	watch := NewChain(e.pool, chaintest.ChainID, client)
	id := "0x" + strings.Repeat("01", 32)
	e.anvil.Mine(2)
	if _, err := watch.Receiver(t.Context(), id); err != nil {
		t.Fatal(err)
	}
	before := len(proxy.Calls())
	for range 3 {
		if _, err := watch.Receiver(t.Context(), id); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("three unchanged-head checks: %d HTTP requests", len(proxy.Calls())-before)
	if len(proxy.Calls())-before > 12 {
		t.Fatal("unchanged finalized evidence is scanned again")
	}
}

func TestReceiverLoad(t *testing.T) {
	for _, n := range []int{1, 100, 300} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			e := setup(t)
			for i := 2; i <= n; i++ {
				_, err := e.pool.Exec(t.Context(), `INSERT INTO invoices (id,profile_id,chain_id,chain_family,token_contract,amount,expires_at,settle_deadline,recipient_address,receive_method,factory_address,receive_address,idempotency_key,request_hash)
 SELECT $1,profile_id,chain_id,chain_family,token_contract,amount,expires_at,settle_deadline,recipient_address,receive_method,factory_address,$2,$1,request_hash FROM invoices LIMIT 1`, fmt.Sprintf("0x%064x", i), fmt.Sprintf("0x%040x", i+1000))
				if err != nil {
					t.Fatal(err)
				}
			}
			e.anvil.Mine(2)
			proxy := e.anvil.Proxy()
			client, err := rpc.Dial(proxy.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			watch := NewChain(e.pool, chaintest.ChainID, client)
			start := time.Now()
			if err := watch.Receivers(t.Context()); err != nil {
				t.Fatal(err)
			}
			var complete int
			if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM receiver_scans WHERE history_complete").Scan(&complete); err != nil {
				t.Fatal(err)
			}
			t.Logf("receivers=%d complete=%d elapsed=%s HTTP=%d", n, complete, time.Since(start), len(proxy.Calls()))
			if complete != 0 || len(proxy.Calls()) != 0 {
				t.Fatal("untouched options triggered verification or were falsely certified")
			}
		})
	}
}

func TestReceiverHistoryResumesAfterFailureWithoutRescanningGenesis(t *testing.T) {
	e := setupChain(t, chaintest.StartArchive(t))
	id := "0x" + strings.Repeat("01", 32)
	if _, err := e.pool.Exec(t.Context(), "UPDATE receiver_scans SET start_block=0,next_block=0,legacy=true WHERE invoice_id=$1", id); err != nil {
		t.Fatal(err)
	}
	e.anvil.Mine(2 * MaxRange)
	proxy := e.anvil.Proxy()
	client, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	watch := NewChain(e.pool, chaintest.ChainID, client)
	if complete, err := watch.Receiver(t.Context(), id); err != nil || complete {
		t.Fatalf("historical range was not bounded: complete=%v err=%v", complete, err)
	}
	var next uint64
	if err := e.pool.QueryRow(t.Context(), "SELECT next_block FROM receiver_scans WHERE invoice_id=$1", id).Scan(&next); err != nil || next != MaxRange {
		t.Fatalf("saved next=%d: %v", next, err)
	}
	if _, err := e.pool.Exec(t.Context(), "UPDATE receiver_scans SET next_at=now() WHERE invoice_id=$1", id); err != nil {
		t.Fatal(err)
	}
	proxy.Fail(func(call chaintest.Call) chaintest.Fault {
		if call.Method == "eth_getLogs" {
			return chaintest.HTTP503
		}
		return chaintest.Forward
	})
	if err := watch.HistoricalReceivers(t.Context()); err == nil {
		t.Fatal("failed source accepted")
	}
	before := len(proxy.Calls())
	if err := watch.HistoricalReceivers(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(proxy.Calls()) != before {
		t.Fatal("historical retry ignored its backoff")
	}
	proxy.Fail(nil)
	if _, err := e.pool.Exec(t.Context(), "UPDATE receiver_scans SET next_at=now(),retry_at=NULL WHERE invoice_id=$1", id); err != nil {
		t.Fatal(err)
	}
	watch = NewChain(e.pool, chaintest.ChainID, client)
	if err := watch.HistoricalReceivers(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(t.Context(), "SELECT next_block FROM receiver_scans WHERE invoice_id=$1", id).Scan(&next); err != nil || next != 2*MaxRange {
		t.Fatalf("restart lost saved progress: next=%d err=%v", next, err)
	}
	for _, call := range proxy.Calls()[before:] {
		if call.Method == "eth_getLogs" {
			var filter struct {
				From string `json:"fromBlock"`
			}
			if err := json.Unmarshal(call.Params[0], &filter); err != nil {
				t.Fatal(err)
			}
			if filter.From == "0x0" {
				t.Fatal("restart scanned genesis again")
			}
		}
	}
}
