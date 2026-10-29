package tests

import (
	"context"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

// deposit books a confirmed transfer of amount to the invoice id; the ledger reads 2.5 USDC on chain.
func (e invoiceEnv) deposit(t *testing.T, id, amount string) {
	t.Helper()
	e.exec(t, `UPDATE chain_cursors SET last_scanned_block = 100, last_finalized_block = 100,
		last_finalized_time = extract(epoch FROM now())::bigint WHERE chain_id = 84532`)
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT 84532, 'evm', $1, $2, $2, 0, $2, 90, extract(epoch FROM now())::bigint, $3, receive_address, $4::numeric,
		    'confirmed' FROM invoices WHERE id = $2`, usdc, id, aliceWallet, amount)
	balances := func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return big.NewInt(2500000), 100, nil
	}
	notDeployed := func(context.Context, uint64, string, string) (uint64, error) { return 0, nil }
	if err := ledger.NewService(e.pool, balances, notDeployed).Process(context.Background(), id); err != nil {
		t.Fatal(err)
	}
}

// R-95.
func TestOwedToYou(t *testing.T) {
	e := invoiceAPI(t)
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

	late3 := create("late-3", "5000000", day(-3))
	e.deposit(t, late3, "1000000")
	late10 := create("late-10", "5000000", day(-10))
	partly := create("partly", "5000000", day(7))
	e.deposit(t, partly, "1500000")
	canceled := create("canceled", "5000000", "")
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+canceled+"/cancel", "did:privy:alice", "", ""); r.status != http.StatusOK {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	e.deposit(t, canceled, "2000000")
	paid := create("paid", "2000000", day(-5))
	e.deposit(t, paid, "2000000")
	// All of it booked, but the second RPC reads less than that, so it waits as detected: nothing is left.
	waiting := create("waiting", "5000000", day(-1))
	e.deposit(t, waiting, "5000000")
	create("due-today", "5000000", day(0))
	create("undated", "5000000", "")
	closed := create("closed", "5000000", day(-20))
	e.closeCheckout(t, closed)

	// D-114: the canceled invoice's money is held for its payer, so it is not owed.
	want := []string{
		"overdue " + late10 + " 10 5000000",
		"overdue " + late3 + " 3 4000000",
		"partlyPaid " + partly + " 0 3500000",
	}
	for _, limit := range []int{50, 2} {
		r := e.call(t, "GET", fmt.Sprintf("/v1/profiles/%s/owed?limit=%d", e.aliceProfile, limit), "did:privy:alice", "", "")
		if r.status != http.StatusOK {
			t.Fatalf("owed: %d %v", r.status, r.body)
		}
		var got []string
		for _, it := range r.body["items"].([]any) {
			o := it.(map[string]any)
			got = append(got, fmt.Sprintf("%s %s %v %s", o["kind"], o["invoiceId"], o["daysLate"], o["amount"]))
			if o["symbol"] != "USDC" || o["decimals"] != float64(6) || o["optionCount"] != float64(1) ||
				o["purpose"] != "invoice" || o["documentKind"] != "invoice" || o["number"] == nil {
				t.Fatalf("item %v", o)
			}
		}
		page := want[:min(limit, len(want))]
		if strings.Join(got, "\n") != strings.Join(page, "\n") {
			t.Fatalf("owed, limit %d:\n%s\nwant:\n%s", limit, strings.Join(got, "\n"), strings.Join(page, "\n"))
		}
		// Count and totals cover every row, not only the page's.
		totals := fmt.Sprint(r.body["totals"])
		if r.body["count"] != float64(3) ||
			totals != "[map[amount:12500000 chainId:84532 decimals:6 symbol:USDC token:"+usdc+"]]" {
			t.Fatalf("limit %d: count %v, totals %s", limit, r.body["count"], totals)
		}
	}
	for _, limit := range []string{"0", "101"} {
		if r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/owed?limit="+limit, "did:privy:alice", "", ""); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("limit %s: %d %v", limit, r.status, r.body)
		}
	}

	if r := e.call(t, "GET", "/v1/profiles/"+e.bobProfile+"/owed", "did:privy:alice", "", ""); r.status != http.StatusForbidden {
		t.Fatalf("Bob's profile: %d %v, want 403", r.status, r.body)
	}
}

// R-95, D-107: a checkout session has no number, so its order reference names it.
func TestOwedListsOpenPartlyPaidCheckoutSessions(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	base := "/v1/profiles/" + shop
	store := storeIDs(t, e, shop)[0]
	session := func(key, reference string) string {
		t.Helper()
		r := e.call(t, "POST", base+"/checkout-sessions", alice, key, `{"storeId":"`+store+`","amountUsd":"2.00","reference":"`+reference+
			`","customer":{"name":"Bea Buyer"}}`)
		if r.status != http.StatusCreated {
			t.Fatalf("create checkout: %d %v", r.status, r.body)
		}
		return r.body["sessionId"].(string)
	}
	partly := session("partly", "order-1")
	e.deposit(t, partly, "500000")
	e.deposit(t, session("paid", "order-2"), "2000000")
	session("unpaid", "order-3")
	closed := session("closed", "order-4")
	e.deposit(t, closed, "500000")
	e.closeCheckout(t, closed)

	r := e.call(t, "GET", base+"/owed", alice, "", "")
	items, _ := r.body["items"].([]any)
	if r.status != http.StatusOK || len(items) != 1 || r.body["count"] != float64(1) {
		t.Fatalf("owed: %d %v; want only the open, partly paid session", r.status, r.body)
	}
	o := items[0].(map[string]any)
	if o["kind"] != "partlyPaid" || o["invoiceId"] != partly || o["number"] != nil || o["purpose"] != "checkout" ||
		o["documentKind"] != "none" || o["reference"] != "order-1" || o["clientName"] != "Bea Buyer" ||
		o["dueDate"] != nil || o["amount"] != "1500000" {
		t.Fatalf("checkout row %v", o)
	}
}

func TestUnselectedOptionEarlyCloseKeepsOtherOptionAvailable(t *testing.T) {
	for _, shortMain := range []bool{true, false} {
		t.Run(fmt.Sprint(shortMain), func(t *testing.T) {
			e := invoiceAPI(t)
			const alice = "did:privy:alice"
			e.exec(t, `INSERT INTO tokens (chain_id,chain_family,contract,symbol,decimals,enabled)
                VALUES (84532,'evm','0x3333333333333333333333333333333333333333','EURC',2,true)`)
			made := e.post(t, alice, e.aliceProfile, "mixed-close", `{"amountUsd":"5.00","expiresIn":5184000}`)
			if made.status != http.StatusCreated {
				t.Fatalf("create: %d %v", made.status, made.body)
			}
			options := made.body["options"].([]any)
			if len(options) < 2 {
				t.Fatalf("need two accepted options: %v", options)
			}
			id := made.body["invoiceId"].(string)
			short := id
			if !shortMain {
				short = options[1].(map[string]any)["optionId"].(string)
			}
			e.exec(t, "UPDATE invoices SET receiver_deployed_at = $2 WHERE id = $1", short, time.Now().Add(-30*24*time.Hour).Unix())
			got := e.get(t, id)
			if got.status != http.StatusOK || got.body["closed"] != false || got.body["paymentStatus"] != "open" || got.body["closesAt"] != made.body["expiresAt"] {
				t.Fatalf("one early option closed whole attempt: %d %v", got.status, got.body)
			}
			seenShort := false
			for _, item := range got.body["options"].([]any) {
				option := item.(map[string]any)
				closeAt, err := time.Parse(time.RFC3339, option["closesAt"].(string))
				if err != nil {
					t.Fatal(err)
				}
				if option["optionId"] == short {
					seenShort = true
					if !closeAt.Before(time.Now()) {
						t.Fatalf("early close missing: %v", option)
					}
				}
			}
			if !seenShort {
				t.Fatal("short option missing")
			}
		})
	}
}
