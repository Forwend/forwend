package tests

import (
	"context"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/invoiceapi"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

func (e invoiceEnv) recheck(t *testing.T, srv *httptest.Server, id string) reply {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/invoices/"+e.link(t, id)+"/recheck", nil)
	if err != nil {
		t.Fatal(err)
	}
	return e.do(t, req)
}

// R-55. The env's address holds 2500000 finalized.
func TestRecheckInvoice(t *testing.T) {
	e := invoiceAPI(t)
	ctx := context.Background()
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)

	r := e.recheck(t, e.srv, id)
	next, _ := time.Parse(time.RFC3339, r.body["nextCheckAt"].(string))
	if r.status != http.StatusOK || r.body["onChain"] != "2500000" || r.body["recorded"] != "0" ||
		r.body["rescanning"] != true || time.Until(next) < 295*time.Second || time.Until(next) > 301*time.Second {
		t.Fatalf("first check: %d %v", r.status, r.body)
	}
	var asked bool
	if err := e.pool.QueryRow(ctx, "SELECT rescan_requested_at IS NOT NULL FROM invoice_rechecks WHERE invoice_id = $1",
		id).Scan(&asked); err != nil || !asked {
		t.Fatalf("rescan asked: %v (%v)", asked, err)
	}

	again := e.recheck(t, e.srv, id)
	if again.status != http.StatusTooManyRequests || errorCode(again) != "rate_limited" {
		t.Fatalf("within 5 minutes: %d %v", again.status, again.body)
	}
	if got := e.get(t, id).body["nextCheckAt"]; got != r.body["nextCheckAt"] {
		t.Fatalf("read nextCheckAt %v, want %v", got, r.body["nextCheckAt"])
	}

	// After the wait, with the deposit recorded and the rescan done, nothing more is asked.
	if _, err := e.pool.Exec(ctx, `
		WITH r AS (UPDATE invoice_rechecks SET checked_at = now() - interval '301 seconds', rescan_requested_at = NULL
		           WHERE invoice_id = $1)
		INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index, block_hash,
		    block_number, block_time, from_address, to_address, amount, status)
		SELECT 84532, 'evm', token_contract, id, '0x' || repeat('01', 32), 0, '0x' || repeat('01', 32), 90, 1, $2,
		    receive_address, 2500000, 'confirmed' FROM invoices WHERE id = $1`, id, aliceWallet); err != nil {
		t.Fatal(err)
	}
	if r := e.recheck(t, e.srv, id); r.status != http.StatusOK || r.body["recorded"] != "2500000" || r.body["rescanning"] != false {
		t.Fatalf("up to date: %d %v", r.status, r.body)
	}

	// A rescan that finished a minute ago is not started again, though the address holds more than recorded.
	if _, err := e.pool.Exec(ctx, `
		WITH t AS (DELETE FROM chain_transfers WHERE invoice_id = $1)
		UPDATE invoice_rechecks SET checked_at = now() - interval '301 seconds', rescanned_at = now() - interval '1 minute'
		WHERE invoice_id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if r := e.recheck(t, e.srv, id); r.status != http.StatusOK || r.body["recorded"] != "0" || r.body["rescanning"] != false {
		t.Fatalf("after a recent rescan: %d %v, want no new rescan", r.status, r.body)
	}

	if r := e.recheck(t, e.srv, "0x"+strings.Repeat("ab", 32)); r.status != http.StatusNotFound || errorCode(r) != "invoice_not_found" {
		t.Fatalf("unknown invoice: %d %v", r.status, r.body)
	}
}

func TestRecheckLimitsAndChainErrors(t *testing.T) {
	e := invoiceAPI(t)
	failing := httptest.NewServer(httpapi.NewMux(e.pool, nil, nil,
		func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
			return nil, 0, errors.New(`Post "https://base-sepolia.infura.io/v3/sekretkey123": dial tcp: refused`)
		}, nil, nil, webURL, 0, nil, false, invoice.Pricing{}))
	t.Cleanup(failing.Close)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-0", basicBody).body["invoiceId"].(string)
	r := e.recheck(t, failing, id)
	if r.status != http.StatusServiceUnavailable || errorCode(r) != "network_unavailable" ||
		strings.Contains(r.body["error"].(map[string]any)["message"].(string), "sekretkey123") {
		t.Fatalf("chain error: %d %v", r.status, r.body)
	}

	var limited int
	for i := range invoiceapi.RecheckBurst + 2 {
		id := e.post(t, "did:privy:alice", e.aliceProfile, "burst-"+string(rune('a'+i)), basicBody).body["invoiceId"].(string)
		if e.recheck(t, e.srv, id).status == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Fatalf("%d checks of different invoices at once: none limited", invoiceapi.RecheckBurst+2)
	}
}

func TestUnknownInvoicesDoNotUseTheSharedCheckLimit(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "unknown-recheck", basicBody).body["invoiceId"].(string)
	unknown := "0x" + strings.Repeat("0", 64)
	for range invoiceapi.RecheckBurst + 1 {
		if r := e.recheck(t, e.srv, unknown); r.status != http.StatusNotFound && r.status != http.StatusTooManyRequests {
			t.Fatalf("unknown id: %d %v", r.status, r.body)
		}
	}
	if r := e.recheck(t, e.srv, id); r.status != http.StatusOK {
		t.Fatalf("first check of a real invoice after %d unknown-id requests (no RPC read): %d %v, want 200",
			invoiceapi.RecheckBurst+1, r.status, r.body)
	}
}

// R-55.
func TestRecheckBudgetHasAShareForEachOwner(t *testing.T) {
	e := invoiceAPI(t)
	victim := e.post(t, "did:privy:alice", e.aliceProfile, "victim", basicBody).body["invoiceId"].(string)
	e.exec(t, `INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		VALUES ($1, 'privy', 'bob-wallet', 'evm', '0x3333333333333333333333333333333333333333')`, e.bobProfile)
	limited := 0
	for i := range invoiceapi.RecheckBurst {
		own := e.post(t, "did:privy:bob", e.bobProfile, "b"+strconv.Itoa(i), basicBody).body["invoiceId"].(string)
		if r := e.recheck(t, e.srv, own); r.status == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Fatalf("one owner's %d checks at once: none limited", invoiceapi.RecheckBurst)
	}
	if r := e.recheck(t, e.srv, victim); r.status != http.StatusOK {
		t.Fatalf("another owner's payer: %d %s, want 200", r.status, errorCode(r))
	}
}
