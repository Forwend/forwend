package watcher

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
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
	if _, err := e.chain.Receiver(t.Context(), e.anvil.RPC, id); err == nil {
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
		if complete, err := e.chain.Receiver(t.Context(), e.anvil.RPC, id); err != nil || !complete {
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
	if err := e.chain.Receivers(ctx, second); err == nil {
		t.Fatal("unavailable provider accepted")
	}
	var deferred int
	if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM receiver_scans WHERE retry_at > now()").Scan(&deferred); err != nil || deferred != 3 {
		t.Fatalf("failed queue slots deferred=%d: %v", deferred, err)
	}
	if err := e.chain.Receivers(t.Context(), e.anvil.RPC); err != nil {
		t.Fatal(err)
	}
	var complete int
	if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM receiver_scans WHERE history_complete").Scan(&complete); err != nil || complete != 1 {
		t.Fatalf("healthy receiver starved: complete=%d: %v", complete, err)
	}
}

func TestReceiverEvidenceRejectsASecondProviderOnAnotherChain(t *testing.T) {
	e := setup(t)
	other := chaintest.StartChain(t, 84532)
	id := "0x" + strings.Repeat("01", 32)
	if _, err := e.chain.Receiver(t.Context(), other.RPC, id); err == nil {
		t.Fatal("wrong-chain source accepted")
	}
	var advanced bool
	if err := e.pool.QueryRow(t.Context(), "SELECT opening_checked FROM receiver_scans WHERE invoice_id = $1", id).Scan(&advanced); err != nil || advanced {
		t.Fatalf("wrong-chain coverage advanced: %v %v", advanced, err)
	}
}
