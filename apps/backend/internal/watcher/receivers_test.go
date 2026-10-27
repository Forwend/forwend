package watcher

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

func TestReceiverEvidenceCommitsWithCoverageAndNeverChanges(t *testing.T) {
	e := setup(t)
	id := "0x" + strings.Repeat("01", 32)
	e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Mine(2)
	if _, err := e.pool.Exec(t.Context(), `CREATE FUNCTION reject_test_proof() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'test proof write failed'; END $$;
 CREATE TRIGGER reject_test_proof BEFORE INSERT ON receiver_deposit_proofs FOR EACH ROW EXECUTE FUNCTION reject_test_proof()`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.chain.Receiver(t.Context(), id); err == nil {
		t.Fatal("failed evidence write advanced coverage")
	}
	var deposits, proofs int
	var checked bool
	if err := e.pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM chain_transfers),
   (SELECT count(*) FROM receiver_deposit_proofs),opening_checked FROM receiver_scans WHERE invoice_id = $1`, id).Scan(&deposits, &proofs, &checked); err != nil || deposits != 0 || proofs != 0 || checked {
		t.Fatalf("partial evidence deposits=%d proofs=%d checked=%v: %v", deposits, proofs, checked, err)
	}
	if _, err := e.pool.Exec(t.Context(), "DROP TRIGGER reject_test_proof ON receiver_deposit_proofs; DROP FUNCTION reject_test_proof()"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if complete, err := e.chain.Receiver(t.Context(), id); err != nil || !complete {
			t.Fatalf("complete=%v: %v", complete, err)
		}
	}
	if err := e.pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM chain_transfers),
   (SELECT count(*) FROM receiver_deposit_proofs),history_complete FROM receiver_scans WHERE invoice_id = $1`, id).Scan(&deposits, &proofs, &checked); err != nil || deposits != 1 || proofs != 1 || !checked {
		t.Fatalf("duplicate evidence deposits=%d proofs=%d complete=%v: %v", deposits, proofs, checked, err)
	}
	for _, sql := range []string{"UPDATE chain_transfers SET amount = 1", "DELETE FROM chain_transfers", "DELETE FROM receiver_deposit_proofs"} {
		if _, err := e.pool.Exec(t.Context(), sql); err == nil {
			t.Fatalf("verified evidence changed: %s", sql)
		}
	}
}

func TestReceiverQueueDefersFailedSourcesAfterDeadline(t *testing.T) {
	e := setup(t)
	for n := 2; n <= 4; n++ {
		if _, err := e.pool.Exec(t.Context(), `INSERT INTO invoices (id,profile_id,chain_id,chain_family,token_contract,amount,
    expires_at,settle_deadline,recipient_address,receive_method,factory_address,receive_address,idempotency_key,request_hash)
    SELECT $1,profile_id,chain_id,chain_family,token_contract,amount,expires_at,settle_deadline,recipient_address,
    receive_method,factory_address,$2,$1,request_hash FROM invoices LIMIT 1`, fmt.Sprintf("0x%064x", n), fmt.Sprintf("0x%040x", n)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.pool.Exec(t.Context(), "UPDATE receiver_scans SET legacy=true"); err != nil {
		t.Fatal(err)
	}
	e.anvil.Mine(2)
	proxy := e.anvil.Proxy()
	proxy.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.Hang })
	second, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	if err := NewChain(e.pool, e.chain.chainID, second).HistoricalReceivers(ctx); err == nil {
		t.Fatal("unavailable provider accepted")
	}
	var deferred int
	if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM receiver_scans WHERE retry_at > now()").Scan(&deferred); err != nil || deferred != 1 {
		t.Fatalf("failed queue slots deferred=%d: %v", deferred, err)
	}
	if err := e.chain.HistoricalReceivers(t.Context()); err != nil {
		t.Fatal(err)
	}
	var complete int
	if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM receiver_scans WHERE history_complete").Scan(&complete); err != nil || complete != 2 {
		t.Fatalf("healthy receiver starved: complete=%d: %v", complete, err)
	}
}

func TestReceiverEvidenceRejectsAProviderOnAnotherChain(t *testing.T) {
	e := setup(t)
	other := chaintest.StartChain(t, 84532)
	id := "0x" + strings.Repeat("01", 32)
	if _, err := NewChain(e.pool, e.chain.chainID, other.RPC).Receiver(t.Context(), id); err == nil {
		t.Fatal("wrong-chain source accepted")
	}
	var advanced bool
	if err := e.pool.QueryRow(t.Context(), "SELECT opening_checked FROM receiver_scans WHERE invoice_id = $1", id).Scan(&advanced); err != nil || advanced {
		t.Fatalf("wrong-chain coverage advanced: %v %v", advanced, err)
	}
}

func TestReceiverRejectsFinalizedReorgWithoutAHeightChange(t *testing.T) {
	e := setup(t)
	id := "0x" + strings.Repeat("01", 32)
	e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Mine(2)
	if complete, err := e.chain.Receiver(t.Context(), id); err != nil || !complete {
		t.Fatalf("initial coverage complete=%v: %v", complete, err)
	}
	before, _, err := e.chain.headers(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	e.anvil.Reorg(3)
	after, _, err := e.chain.headers(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if before.Number != after.Number || before.Hash == after.Hash {
		t.Fatalf("test needs a replaced finalized block at the same height: before=%+v after=%+v", before, after)
	}
	if complete, err := e.chain.Receiver(t.Context(), id); err == nil || complete {
		t.Fatalf("same-height finalized fork accepted: complete=%v err=%v", complete, err)
	}
	var reason, hash, balance string
	var proofs int
	if err := e.pool.QueryRow(t.Context(), `SELECT reconciliation_error,scanned_hash,balance::text,
   (SELECT count(*) FROM receiver_deposit_proofs WHERE invoice_id=$1) FROM receiver_scans WHERE invoice_id=$1`, id).Scan(&reason, &hash, &balance, &proofs); err != nil {
		t.Fatal(err)
	}
	if reason != "finalized_coverage_changed" || hash != strings.ToLower(before.Hash.Hex()) || balance != "5000000" || proofs != 1 {
		t.Fatalf("original evidence was replaced or the conflict was hidden: reason=%s hash=%s balance=%s proofs=%d", reason, hash, balance, proofs)
	}
}

func TestReceiverBatchKeepsHealthyPaymentMovingWhenAnotherOpeningReadFails(t *testing.T) {
	e := setup(t)
	e.anvil.Mine(2)
	e.scan(t)
	badID, badReceive := fmt.Sprintf("0x%064x", 2), fmt.Sprintf("0x%040x", 2)
	if _, err := e.pool.Exec(t.Context(), `INSERT INTO invoices (id,profile_id,chain_id,chain_family,token_contract,amount,
   expires_at,settle_deadline,recipient_address,receive_method,factory_address,receive_address,idempotency_key,request_hash)
   SELECT $1,profile_id,chain_id,chain_family,token_contract,amount,expires_at,settle_deadline,recipient_address,
   receive_method,factory_address,$2,$1,request_hash FROM invoices LIMIT 1`, badID, badReceive); err != nil {
		t.Fatal(err)
	}
	var opening uint64
	if err := e.pool.QueryRow(t.Context(), "SELECT start_block-1 FROM receiver_scans WHERE invoice_id=$1", badID).Scan(&opening); err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Transfer(e.token, badReceive, "5000000")
	e.anvil.Mine(2)
	e.scan(t)
	var failures atomic.Int64
	upstream := &http.Client{Timeout: 10 * time.Second}
	t.Cleanup(upstream.CloseIdleConnections)
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		var calls []struct {
			ID     json.RawMessage   `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		failedIDs := map[string]bool{}
		if json.Unmarshal(body, &calls) == nil {
			for _, call := range calls {
				if call.Method != "eth_call" || len(call.Params) < 2 {
					continue
				}
				var args struct {
					Data string `json:"data"`
				}
				var block string
				if json.Unmarshal(call.Params[0], &args) != nil || json.Unmarshal(call.Params[1], &block) != nil {
					continue
				}
				if strings.HasSuffix(args.Data, strings.TrimPrefix(badReceive, "0x")) && block == fmt.Sprintf("0x%x", opening) {
					failedIDs[string(call.ID)] = true
				}
			}
		}
		request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, e.anvil.URL, bytes.NewReader(body))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		request.Header.Set("Content-Type", "application/json")
		response, err := upstream.Do(request)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		out, err := io.ReadAll(response.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		if len(failedIDs) > 0 {
			var replies []map[string]json.RawMessage
			if err := json.Unmarshal(out, &replies); err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			for _, reply := range replies {
				if failedIDs[string(reply["id"])] {
					delete(reply, "result")
					reply["error"] = json.RawMessage(`{"code":-32000,"message":"historical state unavailable"}`)
					failures.Add(1)
				}
			}
			out, err = json.Marshal(replies)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(response.StatusCode)
		_, _ = w.Write(out)
	}))
	t.Cleanup(proxy.Close)
	second, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if err := NewChain(e.pool, e.chain.chainID, second).Receivers(t.Context()); err == nil {
		t.Fatal("failed opening read was accepted")
	}
	if failures.Load() != 1 {
		t.Fatalf("expected one failed batch member, got %d", failures.Load())
	}
	book := ledger.NewService(e.pool, ledger.BalanceSnapshot(ethclient.NewClient(e.anvil.RPC)), nil)
	if err := book.ProcessChain(t.Context(), chaintest.ChainID); err != nil {
		t.Fatal(err)
	}
	goodID := "0x" + strings.Repeat("01", 32)
	for _, want := range []struct {
		id, status string
		complete   bool
		proofs     int
	}{{goodID, "paid", true, 1}, {badID, "detected", false, 0}} {
		var status string
		var complete bool
		var proofs int
		if err := e.pool.QueryRow(t.Context(), `SELECT i.payment_status,s.history_complete,
    (SELECT count(*) FROM receiver_deposit_proofs p WHERE p.invoice_id=i.id)
    FROM invoices i JOIN receiver_scans s ON s.invoice_id=i.id WHERE i.id=$1`, want.id).Scan(&status, &complete, &proofs); err != nil {
			t.Fatal(err)
		}
		if status != want.status || complete != want.complete || proofs != want.proofs {
			t.Fatalf("receiver %s: status=%s complete=%v proofs=%d; want %+v", want.id, status, complete, proofs, want)
		}
	}
}

func TestReceiverCommitsCatchupWithinProviderRangeLimit(t *testing.T) {
	e := setupChain(t, chaintest.StartArchive(t))
	id := "0x" + strings.Repeat("01", 32)
	e.anvil.Mine(3000)
	var rejected, rejectedBatches atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var call struct {
			ID     json.RawMessage
			Method string
			Params []json.RawMessage
		}
		_ = json.Unmarshal(body, &call)
		if len(body) > 0 && body[0] == '[' {
			var batch []json.RawMessage
			_ = json.Unmarshal(body, &batch)
			if len(batch) > 3 {
				rejectedBatches.Add(1)
				w.WriteHeader(500)
				fmt.Fprint(w, `[{"jsonrpc":"2.0","id":1,"error":{"code":31,"message":"Batch of more than 3 requests are not allowed on free plan"}}]`)
				return
			}
			if len(batch) == 1 {
				body = batch[0]
			}
		}
		if call.Method == "eth_getLogs" {
			var filter struct {
				From hexutil.Uint64 `json:"fromBlock"`
				To   hexutil.Uint64 `json:"toBlock"`
			}
			_ = json.Unmarshal(call.Params[0], &filter)
			if filter.To-filter.From+1 > 100 {
				rejected.Add(1)
				w.WriteHeader(http.StatusBadRequest)
				fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":35,"message":"ranges over 10000 blocks are not supported on free plan"}}`, call.ID)
				return
			}
		}
		response, err := http.Post(e.anvil.URL, "application/json", bytes.NewReader(body))
		if err != nil {
			t.Error(err)
			w.WriteHeader(502)
			return
		}
		defer response.Body.Close()
		_, _ = io.Copy(w, response.Body)
	}))
	defer proxy.Close()
	second, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	e.chain = NewChain(e.pool, e.chain.chainID, second)
	if done, err := e.chain.Receiver(t.Context(), id); err != nil || done {
		t.Fatalf("bounded checkpoint done=%v err=%v", done, err)
	}
	var next uint64
	if err := e.pool.QueryRow(t.Context(), "SELECT next_block FROM receiver_scans WHERE invoice_id=$1", id).Scan(&next); err != nil || next == 0 || next > 2100 {
		t.Fatalf("checkpoint=%d err=%v", next, err)
	}
	before := rejected.Load()
	batchesBefore := rejectedBatches.Load()
	previous := next
	budget, err := chain.NewBudget(t.Context(), e.pool, 10)
	if err != nil {
		t.Fatal(err)
	}
	defer budget.Close()
	clients, err := chain.NewRPCs(chain.Spec{ChainID: chaintest.ChainID, AllowLoopback: true, Endpoints: []chain.Endpoint{
		{ID: "primary", Provider: "primary", Role: chain.Primary, Tier: chain.Public, URL: proxy.URL, BudgetGroup: "shared-test-budget"},
	}}, 10, budget)
	if err != nil {
		t.Fatal(err)
	}
	defer clients.Close()
	paced := NewChain(e.pool, chaintest.ChainID, clients.Client)
	paced.span, paced.batchSize = e.chain.span, e.chain.batchSize
	e.anvil.Mine(2)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	if _, err := paced.Receiver(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(t.Context(), "SELECT next_block FROM receiver_scans WHERE invoice_id=$1", id).Scan(&next); err != nil || next <= previous || next-previous > e.chain.span {
		t.Fatalf("checkpoint advanced %d blocks with provider range %d: %v", next-previous, e.chain.span, err)
	}
	if rejectedBatches.Load() != batchesBefore {
		t.Fatal("repeated oversized header batch")
	}
	if rejected.Load() != before {
		t.Fatalf("repeated rejected ranges: before=%d after=%d", before, rejected.Load())
	}
}

func TestReceiverCatchupDoesNotBypassRetryOrHistoricalQueue(t *testing.T) {
	for _, future := range []bool{true, false} {
		t.Run(fmt.Sprint(future), func(t *testing.T) {
			e := setupChain(t, chaintest.StartArchive(t))
			e.anvil.Transfer(e.token, receive, "1000000")
			e.anvil.Mine(3)
			if err := e.chain.Scan(t.Context()); err != nil {
				t.Fatal(err)
			}
			var block uint64
			if err := e.pool.QueryRow(t.Context(), "SELECT max(block_number) FROM chain_transfers").Scan(&block); err != nil {
				t.Fatal(err)
			}
			start := block + 1
			if future {
				start = block + 100
			}
			if _, err := e.pool.Exec(t.Context(), "UPDATE receiver_scans SET start_block=$1,next_block=$1", start); err != nil {
				t.Fatal(err)
			}
			proxy := e.anvil.Proxy()
			client, err := rpc.Dial(proxy.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			watch := NewChain(e.pool, chaintest.ChainID, client)
			ctx, cancel := context.WithTimeout(t.Context(), time.Second)
			defer cancel()
			if err := watch.Receivers(ctx); err != nil {
				t.Fatal(err)
			}
			for _, call := range proxy.Calls() {
				if call.Method == "eth_getLogs" {
					t.Fatal("active retry entered historical logs")
				}
			}
			if len(proxy.Calls()) > 8 {
				t.Fatalf("repeated unchanged work: %d requests", len(proxy.Calls()))
			}
		})
	}
}

func TestReceiverBatchDoesNotPrefetchDeepCatchup(t *testing.T) {
	e := setupChain(t, chaintest.StartArchive(t))
	id := "0x" + strings.Repeat("01", 32)
	e.anvil.Mine(1000)
	proxy := e.anvil.Proxy()
	client, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	watch := NewChain(e.pool, chaintest.ChainID, client)
	watch.span = 62
	var previous uint64
	if err := e.pool.QueryRow(t.Context(), "SELECT next_block FROM receiver_scans WHERE invoice_id=$1", id).Scan(&previous); err != nil {
		t.Fatal(err)
	}
	round, err := watch.receiverRound(t.Context(), []string{id})
	if err != nil {
		t.Fatal(err)
	}
	for _, call := range proxy.Calls() {
		if call.Method == "eth_getLogs" {
			t.Fatal("prefetch read beyond bounded checkpoint")
		}
	}
	done, err := watch.receiver(t.Context(), id, round)
	if err != nil || done {
		t.Fatalf("deep checkpoint done=%v err=%v", done, err)
	}
	var next uint64
	if err := e.pool.QueryRow(t.Context(), "SELECT next_block FROM receiver_scans WHERE invoice_id=$1", id).Scan(&next); err != nil || next != previous+watch.span {
		t.Fatalf("checkpoint=%d err=%v", next, err)
	}
}
