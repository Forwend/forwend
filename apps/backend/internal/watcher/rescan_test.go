package watcher

import (
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

func TestRequestedRescanKeepsItsStartAndDefersFailedReads(t *testing.T) {
	e := setup(t)
	id := "0x" + strings.Repeat("01", 32)
	e.anvil.Mine(20)
	if _, err := e.pool.Exec(t.Context(), "INSERT INTO invoice_rechecks (invoice_id,rescan_requested_at) VALUES ($1,now())", id); err != nil {
		t.Fatal(err)
	}
	watch, proxy := proxiedChain(t, e)
	proxy.Fail(func(call chaintest.Call) chaintest.Fault {
		if call.Method == "eth_getLogs" {
			return chaintest.HTTP503
		}
		return chaintest.Forward
	})
	if err := watch.Rescans(t.Context()); err == nil {
		t.Fatal("failed logs accepted")
	}
	var start *uint64
	var deferred bool
	if err := e.pool.QueryRow(t.Context(), "SELECT rescan_from_block,rescan_retry_at>now() FROM invoice_rechecks WHERE invoice_id=$1", id).Scan(&start, &deferred); err != nil || start == nil || !deferred {
		t.Fatalf("start=%v deferred=%v err=%v", start, deferred, err)
	}
	before := len(proxy.Calls())
	if err := watch.Rescans(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(proxy.Calls()) != before {
		t.Fatal("rescan ignored retry wait")
	}
	proxy.Fail(nil)
	if _, err := e.pool.Exec(t.Context(), "UPDATE invoice_rechecks SET rescan_retry_at=NULL WHERE invoice_id=$1", id); err != nil {
		t.Fatal(err)
	}
	if err := watch.Rescans(t.Context()); err != nil {
		t.Fatal(err)
	}
	var finished bool
	if err := e.pool.QueryRow(t.Context(), "SELECT rescan_requested_at IS NULL AND rescanned_at IS NOT NULL FROM invoice_rechecks WHERE invoice_id=$1", id).Scan(&finished); err != nil || !finished {
		t.Fatalf("rescan unfinished: %v", err)
	}
}

// A rescan of an invoice older than the history the RPCs keep moves past the pruned blocks instead of retrying (R-191).
func TestRescanMovesPastHistoryNoRPCKeeps(t *testing.T) {
	e := setup(t)
	id := "0x" + strings.Repeat("01", 32)
	e.anvil.Mine(200)
	watch, proxy := proxiedChain(t, e)
	if err := watch.ScanNew(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(t.Context(), `INSERT INTO invoice_rechecks (invoice_id, rescan_requested_at, rescan_from_block)
		VALUES ($1, now(), 1)`, id); err != nil {
		t.Fatal(err)
	}
	proxy.Fail(prunedBelow(50))
	if err := watch.Rescans(t.Context()); err != nil {
		t.Fatalf("rescan over pruned history: %v", err)
	}
	var from *uint64
	if err := e.pool.QueryRow(t.Context(), "SELECT rescan_from_block FROM invoice_rechecks WHERE invoice_id = $1", id).Scan(&from); err != nil ||
		from == nil || *from != 50 {
		t.Fatalf("rescan continues from %v (%v), want 50, the oldest block kept", from, err)
	}
}
