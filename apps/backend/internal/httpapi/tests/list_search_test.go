package tests

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func (e invoiceEnv) pages(t *testing.T, path, query string, limit int, key func(map[string]any) any) []any {
	t.Helper()
	got := []any{}
	cursor := ""
	for {
		r := e.call(t, "GET", fmt.Sprintf("%s?limit=%d&cursor=%s&%s", path, limit, cursor, query), "did:privy:alice", "", "")
		items, ok := r.body["items"].([]any)
		if r.status != http.StatusOK || !ok || len(items) > limit {
			t.Fatalf("%s: %d %v", query, r.status, r.body)
		}
		for _, it := range items {
			got = append(got, key(it.(map[string]any)))
		}
		next, _ := r.body["nextCursor"].(string)
		if next == "" {
			return got
		}
		cursor = url.QueryEscape(next)
	}
}

type listCase struct {
	query string
	want  []any
}

// One item per page, so every cursor is used. A user may send 60 requests at once (ratelimit.go): stay under that.
func checkList(t *testing.T, e invoiceEnv, path string, key func(map[string]any) any, cases []listCase) {
	t.Helper()
	for _, c := range cases {
		if got := e.pages(t, path, c.query, 1, key); !reflect.DeepEqual(got, c.want) {
			t.Fatalf("%s: got %v\nwant %v", c.query, got, c.want)
		}
	}
}

func checkListErrors(t *testing.T, e invoiceEnv, path string, badFilters ...string) {
	t.Helper()
	for _, query := range append([]string{"q=", "q=%20%20", "q=" + url.QueryEscape(strings.Repeat("é", 101))}, badFilters...) {
		if r := e.call(t, "GET", path+"?"+query, "did:privy:alice", "", ""); r.status != http.StatusUnprocessableEntity ||
			errorCode(r) != "invalid_value" {
			t.Fatalf("%.40s: %d %v, want 422 invalid_value", query, r.status, r.body)
		}
	}
	if r := e.call(t, "GET", path+"?q="+url.QueryEscape(strings.Repeat("é", 100)), "did:privy:alice", "", ""); r.status != http.StatusOK {
		t.Fatalf("100 characters: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", path+"?q=a", "did:privy:bob", "", ""); r.status != http.StatusForbidden || errorCode(r) != "forbidden" {
		t.Fatalf("Bob: %d %v, want 403", r.status, r.body)
	}
}

func (e invoiceEnv) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

// Terms never change in production (the invoices_guard trigger), so this lifts it for one update.
func (e invoiceEnv) closeCheckout(t *testing.T, id string) {
	t.Helper()
	e.exec(t, `ALTER TABLE invoices DISABLE TRIGGER invoices_guard`)
	e.exec(t, `UPDATE invoices SET expires_at = extract(epoch FROM now())::bigint - 60 WHERE id = $1`, id)
	e.exec(t, `ALTER TABLE invoices ENABLE TRIGGER invoices_guard`)
}

func TestListInvoicesFilterAndSearch(t *testing.T) {
	e := invoiceAPI(t)
	body := func(amount, details string) string {
		return `{"chainId": 84532, "token": "` + usdc + `", "amount": "` + amount + `"` + details + `}`
	}
	ids := map[float64]string{}
	var receive string
	for i, b := range []string{
		body("5000000", `, "title": "Logo design", "client": {"name": "Bob Ltd", "email": "bob@example.com"}`),
		body("1250500000", ""),
		body("7000000", `, "title": "Website", "reference": "PO-4500012345", "client": {"name": "Kettle & Co.", "email": "kettle@example.org"}`),
		body("2000000", `, "note": "50% now, rest_later"`),
		body("3000000", ""),
	} {
		r := e.post(t, "did:privy:alice", e.aliceProfile, fmt.Sprintf("key-%d", i), b)
		ids[r.body["number"].(float64)] = r.body["invoiceId"].(string)
		receive = r.body["receiveAddress"].(string)
	}
	e.exec(t, `UPDATE invoices SET payment_status = 'expired' WHERE id = $1`, ids[1])
	e.exec(t, `UPDATE invoices SET payment_status = 'paid' WHERE id IN ($1, $2)`, ids[2], ids[3])
	e.exec(t, `UPDATE invoices SET settlement_status = 'settled' WHERE id = $1`, ids[3])
	e.exec(t, `UPDATE invoices SET payment_status = 'detected' WHERE id = $1`, ids[4])
	e.closeCheckout(t, ids[5])                                                                // open, but its checkout has closed
	e.post(t, "did:privy:alice", e.walletless, "other", body("7000000", `, "title": "Logo"`)) // another profile's

	path := "/v1/profiles/" + e.aliceProfile + "/invoices"
	checkList(t, e, path, func(it map[string]any) any { return it["number"] }, []listCase{
		{"", []any{5.0, 4.0, 3.0, 2.0, 1.0}},
		{"status=open", []any{}},
		{"status=confirming", []any{4.0}},
		{"status=paid", []any{3.0, 2.0}},
		{"status=settled", []any{3.0}},
		{"status=expired", []any{5.0, 1.0}}, // expired, and open with its checkout closed
		// D-114: the Payments list's states, on invoices too.
		{"state=waiting", []any{}},
		{"state=confirming", []any{4.0}},
		{"state=paid", []any{3.0, 2.0}},
		{"state=expired", []any{5.0, 1.0}},
		{"state=paid&q=kettle", []any{3.0}},
		{"q=INV-0003", []any{3.0}},
		{"q=inv-000", []any{5.0, 4.0, 3.0, 2.0, 1.0}},
		{"q=LOGO", []any{1.0}},          // title
		{"q=50%25+now", []any{4.0}},     // note
		{"q=_", []any{4.0}},             // a character, not LIKE's wildcard
		{"q=kettle", []any{3.0}},        // client name
		{"q=bob%40example", []any{1.0}}, // client email
		{"q=po-45000", []any{3.0}},      // reference
		{"q=" + strings.ToUpper(receive[10:30]), []any{5.0}},
		{"q=1%2C250.50", []any{2.0}}, // amount: 1,250.50 USDC exactly
		{"q=1250.5", []any{2.0}},
		{"q=7.00", []any{3.0}},
		{"q=7.000001", []any{}},
		{"q=nothing", []any{}},
		{"status=settled&q=kettle", []any{3.0}},
		{"status=paid&q=kettle", []any{3.0}},
	})
	checkListErrors(t, e, path, "status=all", "status=refunded", "state=open")
}

// R-77.
func TestClosedCheckoutReadsExpired(t *testing.T) {
	e := invoiceAPI(t)
	var ids []string
	for i := range 5 {
		ids = append(ids, e.post(t, "did:privy:alice", e.aliceProfile, fmt.Sprintf("key-%d", i), basicBody).body["invoiceId"].(string))
		e.closeCheckout(t, ids[i])
	}
	transfer := func(id string, log int, amount int64, status string, after int) {
		e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			    block_hash, block_number, block_time, from_address, to_address, amount, status)
			SELECT 84532, 'evm', $1, $2, $3, $4, $3, 1, expires_at + $8, $5, receive_address, $6, $7 FROM invoices WHERE id = $2`,
			usdc, id, "0x"+strings.Repeat(fmt.Sprintf("%02x", log), 32), log, aliceWallet, amount, status, after)
	}
	onTime := func(id string, log int, amount int64, status string) { transfer(id, log, amount, status, -10) }
	// 0: nothing paid. 1: 1 of 5 USDC paid on time. 2: 2 more seen on time and still confirming. 3: all 5 paid
	// on time, the second RPC not yet agreeing, so still partially_paid.
	onTime(ids[1], 1, 1000000, "confirmed")
	onTime(ids[2], 2, 1000000, "confirmed")
	onTime(ids[2], 3, 2000000, "detected")
	onTime(ids[3], 4, 5000000, "confirmed")
	e.exec(t, `UPDATE invoices SET payment_status = 'partially_paid' WHERE id IN ($1, $2, $3)`, ids[1], ids[2], ids[3])
	// 4: only money after the close, which reads detected until the chain is final past expiry.
	transfer(ids[4], 5, 5000000, "confirmed", 10)
	e.exec(t, `UPDATE invoices SET payment_status = 'detected' WHERE id = $1`, ids[4])

	closed := []bool{true, true, false, false, true}
	for i, id := range ids {
		r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id, "did:privy:alice", "", "")
		if r.body["closed"] != closed[i] {
			t.Fatalf("invoice %d: closed %v, want %v", i, r.body["closed"], closed[i])
		}
	}
	index := func(it map[string]any) any { return float64(slices.Index(ids, it["invoiceId"].(string))) }
	checkList(t, e, "/v1/profiles/"+e.aliceProfile+"/invoices", index, []listCase{
		{"status=expired", []any{4.0, 1.0, 0.0}},
		{"status=open", []any{}},
		{"status=confirming", []any{3.0, 2.0}},
	})
	checkList(t, e, "/v1/profiles/"+e.aliceProfile+"/activity", func(it map[string]any) any {
		if it["kind"] != "invoice" {
			return "payment"
		}
		i := slices.Index(ids, it["invoiceId"].(string))
		if it["closed"] != closed[i] {
			t.Fatalf("activity invoice %d: closed %v, want %v", i, it["closed"], closed[i])
		}
		return float64(i)
	}, []listCase{{"status=expired", []any{4.0, "payment", 1.0, 0.0}}}) // 1's deposit: no earlier than 1 was made
}

func TestGetActivityFilterAndSearch(t *testing.T) {
	e := invoiceAPI(t)
	var ids []string
	for i := range 3 {
		ids = append(ids, e.post(t, "did:privy:alice", e.aliceProfile, fmt.Sprintf("key-%d", i), basicBody).body["invoiceId"].(string))
	}
	confirmed, detected, settle := "0x"+strings.Repeat("ab", 32), "0x"+strings.Repeat("cd", 32), "0x"+strings.Repeat("ef", 32)
	for _, d := range [][2]string{{ids[1], confirmed}, {ids[0], detected}} {
		status := map[string]string{confirmed: "confirmed", detected: "detected"}[d[1]]
		e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			    block_hash, block_number, block_time, from_address, to_address, amount, status)
			SELECT 84532, 'evm', $1, $2, $3, 0, $3, 1, extract(epoch FROM now())::bigint + 60, $4, receive_address, 1000000, $5
			FROM invoices WHERE id = $2`, usdc, d[0], d[1], aliceWallet, status)
	}
	// Booked as the ledger does before it marks an invoice paid: to the owner, so it is a payment, not held.
	e.exec(t, `WITH x AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
		           SELECT invoice_id, 'deposit', id FROM chain_transfers WHERE tx_hash = $1 RETURNING id)
		INSERT INTO ledger_entries (transaction_id, account, amount) SELECT id, 'receiver', 1000000 FROM x
		UNION ALL SELECT id, 'recipient_payable', -1000000 FROM x`, confirmed)
	e.exec(t, `UPDATE invoices SET payment_status = 'paid', settlement_status = 'settled' WHERE id = $1`, ids[1])
	e.exec(t, `INSERT INTO settlement_intents (invoice_id, status, tx_hash) VALUES ($1, 'confirmed', $2)`, ids[1], settle)
	e.exec(t, `UPDATE invoices SET payment_status = 'expired' WHERE id = $1`, ids[2])

	// Newest first: the deposits (in a block after the invoices were made), then the invoices. An invoice pays 5 USDC, a
	// deposit 1 USDC.
	dep := func(hash string) any { return "deposit " + hash }
	inv := func(i int) any { return "invoice " + ids[i] }
	checkList(t, e, "/v1/profiles/"+e.aliceProfile+"/activity", func(it map[string]any) any {
		if it["kind"] == "deposit" {
			return dep(it["txHash"].(string))
		}
		return inv(slices.Index(ids, it["invoiceId"].(string)))
	}, []listCase{
		{"status=open", []any{}},
		{"status=confirming", []any{dep(detected), inv(0)}},
		{"status=paid", []any{dep(confirmed), inv(1)}},
		{"status=settled", []any{dep(confirmed), inv(1)}},
		{"status=expired", []any{inv(2)}},
		{"q=" + strings.ToUpper(confirmed[:12]), []any{dep(confirmed)}},
		{"q=" + settle[20:40], []any{inv(1)}}, // the settle transaction
		{"q=1.0", []any{dep(detected), dep(confirmed)}},
		{"q=5", []any{inv(2), inv(1), inv(0)}},
		{"q=usd", []any{dep(detected), dep(confirmed), inv(2), inv(1), inv(0)}},
		{"status=confirming&q=1", []any{dep(detected)}},
		{"q=nothing", []any{}},
	})
	checkListErrors(t, e, "/v1/profiles/"+e.aliceProfile+"/activity", "status=all", "status=confirmed")
}

func TestGetTransactionsFilterAndSearch(t *testing.T) {
	e := invoiceAPI(t)
	// Transfer n: block time n, hash of the letter pair, counterparty of the digit.
	for _, tr := range []struct {
		n                              int
		direction, hash, party, amount string
	}{
		{1, "in", "aa", "5", "1000000"},
		{2, "out", "bb", "6", "2500000"},
		{3, "in", "cc", "7", "1000000"},
		{4, "out", "dd", "5", "3000000"},
	} {
		e.exec(t, `INSERT INTO wallet_transfers (chain_id, chain_family, token_contract, wallet_address, direction,
			    counterparty, tx_hash, log_index, block_hash, block_number, block_time, amount, status)
			VALUES (84532, 'evm', $1, $2, $3, $4, $5, 0, $5, $6, $6, $7, 'confirmed')`,
			usdc, aliceWallet, tr.direction, "0x"+strings.Repeat(tr.party, 40), "0x"+strings.Repeat(tr.hash, 32), tr.n, tr.amount)
	}
	path := "/v1/profiles/" + e.aliceProfile + "/transactions"
	checkList(t, e, path, func(it map[string]any) any { return it["txHash"].(string)[2:4] }, []listCase{
		{"", []any{"dd", "cc", "bb", "aa"}},
		{"direction=in", []any{"cc", "aa"}},
		{"direction=out", []any{"dd", "bb"}},
		{"q=0X5555", []any{"dd", "aa"}}, // counterparty, any letter case
		{"q=cccc", []any{"cc"}},         // transaction hash
		{"q=usdc", []any{"dd", "cc", "bb", "aa"}},
		{"q=2.5", []any{"bb"}},
		{"q=1", []any{"cc", "aa"}},
		{"direction=out&q=5555", []any{"dd"}},
		{"direction=out&q=1", []any{}},
	})
	checkListErrors(t, e, path, "direction=all", "direction=sideways")
}

func TestSearchAndCursorWithBadBytesAre422(t *testing.T) {
	e := invoiceAPI(t)
	p := "/v1/profiles/" + e.aliceProfile
	cursor := func(s string) string { return url.QueryEscape(base64.RawURLEncoding.EncodeToString([]byte(s))) }
	for _, path := range []string{
		p + "/invoices?q=a%00b", p + "/invoices?q=a%FFb",
		p + "/activity?q=a%00b", p + "/transactions?q=a%FFb",
		p + "/activity?cursor=" + cursor("1|invoice|\x00"),
	} {
		if r := e.call(t, "GET", path, "did:privy:alice", "", ""); r.status != http.StatusUnprocessableEntity {
			t.Errorf("%s: %d %v, want 422 invalid_value", path[len(p):], r.status, r.body)
		}
	}
}
