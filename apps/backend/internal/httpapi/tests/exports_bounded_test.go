package tests

import (
	"net/http"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
)

// R-118.
func TestExportsStayBoundedWithDust(t *testing.T) {
	const alice, stranger = "did:privy:alice", "0x5555555555555555555555555555555555555555"
	e := invoiceAPI(t)
	e.exec(t, `INSERT INTO wallet_transfers (chain_id, chain_family, token_contract, wallet_address, direction,
		    counterparty, tx_hash, log_index, block_hash, block_number, block_time, amount, status)
		SELECT 84532, 'evm', $1, $2, 'in', $3, '0x' || lpad(to_hex(g), 64, '0'), 0, '0x' || lpad(to_hex(g), 64, '0'),
		       g, extract(epoch FROM now())::bigint - g, 1, 'confirmed' FROM generate_series(1, 100000) g`,
		usdc, aliceWallet, stranger)
	e.exec(t, "ANALYZE wallet_transfers")
	allocated := func(calls int, path string, want int, code string) uint64 {
		t.Helper()
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		var wg sync.WaitGroup
		for range calls {
			wg.Go(func() {
				if r := e.call(t, "GET", path, alice, "", ""); r.status != want || (code != "" && errorCode(r) != code) {
					t.Errorf("GET %s: %d %v, want %d %s", path, r.status, r.body, want, code)
				}
			})
		}
		wg.Wait()
		runtime.ReadMemStats(&after)
		return after.TotalAlloc - before.TotalAlloc
	}
	base := "/v1/profiles/" + e.aliceProfile
	if got := allocated(10, base+"/transactions.csv", http.StatusUnprocessableEntity, "too_many_transactions"); got > 300<<20 {
		t.Errorf("ten CSV exports allocated %d MB", got>>20)
	}
	e.exec(t, `INSERT INTO profile_billing_details (profile_id, name, address, country, contact_email)
		VALUES ($1, 'Alice', 'Main St 1', 'DE', 'a@example.com') ON CONFLICT DO NOTHING`, e.aliceProfile)
	if got := allocated(10, base+"/statement.pdf?from=0001-01-01&to=9999-12-31", http.StatusUnprocessableEntity,
		"too_many_transactions"); got > 300<<20 {
		t.Errorf("ten statements allocated %d MB", got>>20)
	}
	if got := allocated(1, base+"/balance-history?days=365", http.StatusOK, ""); got > 10<<20 {
		t.Errorf("balance history allocated %d MB", got>>20)
	}
	if r := e.call(t, "GET", base+"/transactions.csv?from=9999-12-01&to=9999-12-31", alice, "", ""); r.status != http.StatusOK {
		t.Errorf("an empty period: %d %v, want 200", r.status, r.body)
	}
}

// R-118.
func TestExportCapIsExact(t *testing.T) {
	const alice = "did:privy:alice"
	e := invoiceAPI(t)
	dust := func(from, to int) {
		e.exec(t, `INSERT INTO wallet_transfers (chain_id, chain_family, token_contract, wallet_address, direction,
			    counterparty, tx_hash, log_index, block_hash, block_number, block_time, amount, status)
			SELECT 84532, 'evm', $1, $2, 'in', '0x5555555555555555555555555555555555555555',
			       '0x' || lpad(to_hex(g), 64, '0'), 0, '0x' || lpad(to_hex(g), 64, '0'), g, 1790000000 + g, 1, 'confirmed'
			FROM generate_series($3::int, $4::int) g`, usdc, aliceWallet, from, to)
	}
	path := "/v1/profiles/" + e.aliceProfile + "/transactions.csv"
	dust(1, activity.MaxExportRows)
	if r := e.call(t, "GET", path, alice, "", ""); r.status != http.StatusOK ||
		strings.Count(r.raw, "\r\n") != activity.MaxExportRows+1 {
		t.Fatalf("exactly the cap: %d, %d lines; want 200 with a header and %d rows", r.status,
			strings.Count(r.raw, "\r\n"), activity.MaxExportRows)
	}
	dust(activity.MaxExportRows+1, activity.MaxExportRows+1)
	if r := e.call(t, "GET", path, alice, "", ""); r.status != http.StatusUnprocessableEntity ||
		errorCode(r) != "too_many_transactions" {
		t.Fatalf("one over the cap: %d %v, want 422 too_many_transactions", r.status, r.body)
	}
}
