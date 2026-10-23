package tests

import (
	"context"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
)

// R-95.
func TestOwedToYou(t *testing.T) {
	e := invoiceAPI(t)
	ctx := context.Background()
	day := func(days int) string { return time.Now().UTC().AddDate(0, 0, days).Format(time.DateOnly) }
	create := func(key, amount, due string) string {
		t.Helper()
		body := `{"chainId": 84532, "token": "` + usdc + `", "amount": "` + amount + `"`
		if due != "" {
			body += `, "dueDate": "` + due + `"`
		}
		r := e.post(t, "did:privy:alice", e.aliceProfile, key, body+"}")
		if r.status != http.StatusCreated {
			t.Fatalf("create %s: %d %v", key, r.status, r.body)
		}
		return r.body["invoiceId"].(string)
	}
	e.exec(t, `UPDATE chain_cursors SET last_scanned_block = 100, last_finalized_block = 100,
		last_finalized_time = extract(epoch FROM now())::bigint WHERE chain_id = 84532`)
	deposits := 0
	deposit := func(id, amount string) {
		t.Helper()
		deposits++
		e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			    block_hash, block_number, block_time, from_address, to_address, amount, status)
			SELECT 84532, 'evm', $1, $2, $3, 0, $3, 90, extract(epoch FROM now())::bigint, $4, receive_address, $5::numeric,
			    'confirmed' FROM invoices WHERE id = $2`, usdc, id, fmt.Sprintf("0x%064x", deposits), aliceWallet, amount)
		balances := func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
			return big.NewInt(2500000), 100, nil
		}
		if err := ledger.NewService(e.pool, balances).Process(ctx, id); err != nil {
			t.Fatal(err)
		}
	}

	late3 := create("late-3", "5000000", day(-3))
	deposit(late3, "1000000")
	late10 := create("late-10", "5000000", day(-10))
	partly := create("partly", "5000000", day(7))
	deposit(partly, "1500000")
	canceled := create("canceled", "5000000", "")
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+canceled+"/cancel", "did:privy:alice", "", ""); r.status != http.StatusOK {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	deposit(canceled, "2000000")
	paid := create("paid", "2000000", day(-5))
	deposit(paid, "2000000")
	// All of it booked, but the second RPC reads less than that, so it waits as detected: nothing is left.
	waiting := create("waiting", "5000000", day(-1))
	deposit(waiting, "5000000")
	create("due-today", "5000000", day(0))
	create("undated", "5000000", "")
	closed := create("closed", "5000000", day(-20))
	e.closeCheckout(t, closed)

	r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/owed", "did:privy:alice", "", "")
	if r.status != http.StatusOK {
		t.Fatalf("owed: %d %v", r.status, r.body)
	}
	var got []string
	for _, it := range r.body["items"].([]any) {
		o := it.(map[string]any)
		got = append(got, fmt.Sprintf("%s %s %v %s", o["kind"], o["invoiceId"], o["daysLate"], o["amount"]))
		if o["symbol"] != "USDC" || o["decimals"] != float64(6) || o["optionCount"] != float64(1) {
			t.Fatalf("item %v", o)
		}
	}
	want := []string{
		"overdue " + late10 + " 10 5000000",
		"overdue " + late3 + " 3 4000000",
		"partlyPaid " + partly + " 0 3500000",
		"held " + canceled + " 0 2000000",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("owed:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}

	if r := e.call(t, "GET", "/v1/profiles/"+e.bobProfile+"/owed", "did:privy:alice", "", ""); r.status != http.StatusForbidden {
		t.Fatalf("Bob's profile: %d %v, want 403", r.status, r.body)
	}
}
