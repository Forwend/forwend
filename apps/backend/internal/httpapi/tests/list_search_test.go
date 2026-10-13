package tests

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"testing"
)

// pages reads a list under query in pages of limit items and returns each item as key says.
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

// checkList reads each case one item per page, so every cursor continues the filtered list. A user may send 60
// requests at once (ratelimit.go), so a test stays under that.
func checkList(t *testing.T, e invoiceEnv, path string, key func(map[string]any) any, cases []listCase) {
	t.Helper()
	for _, c := range cases {
		if got := e.pages(t, path, c.query, 1, key); !reflect.DeepEqual(got, c.want) {
			t.Fatalf("%s: got %v\nwant %v", c.query, got, c.want)
		}
	}
}

// checkListErrors: a blank or too long search and a filter value the list does not know are 422; another user is 403.
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
		body("7000000", `, "title": "Website", "client": {"name": "Kettle & Co.", "email": "kettle@example.org"}`),
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
	e.post(t, "did:privy:alice", e.walletless, "other", body("7000000", `, "title": "Logo"`)) // another profile's

	path := "/v1/profiles/" + e.aliceProfile + "/invoices"
	checkList(t, e, path, func(it map[string]any) any { return it["number"] }, []listCase{
		{"", []any{5.0, 4.0, 3.0, 2.0, 1.0}},
		{"status=open", []any{5.0, 4.0}}, // open and detected
		{"status=paid", []any{2.0}},
		{"status=settled", []any{3.0}},
		{"status=expired", []any{1.0}},
		{"q=INV-0003", []any{3.0}},
		{"q=inv-000", []any{5.0, 4.0, 3.0, 2.0, 1.0}},
		{"q=LOGO", []any{1.0}},          // title
		{"q=50%25+now", []any{4.0}},     // note
		{"q=_", []any{4.0}},             // a character, not LIKE's wildcard
		{"q=kettle", []any{3.0}},        // client name
		{"q=bob%40example", []any{1.0}}, // client email
		{"q=" + strings.ToUpper(receive[10:30]), []any{5.0}},
		{"q=1%2C250.50", []any{2.0}}, // amount: 1,250.50 USDC exactly
		{"q=1250.5", []any{2.0}},
		{"q=7.00", []any{3.0}},
		{"q=7.000001", []any{}},
		{"q=nothing", []any{}},
		{"status=settled&q=kettle", []any{3.0}},
		{"status=paid&q=kettle", []any{}},
	})
	checkListErrors(t, e, path, "status=all", "status=refunded")
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
			SELECT 84532, 'evm', $1, $2, $3, 0, $3, 1, 1, $4, receive_address, 1000000, $5 FROM invoices WHERE id = $2`,
			usdc, d[0], d[1], aliceWallet, status)
	}
	e.exec(t, `UPDATE invoices SET payment_status = 'paid', settlement_status = 'settled' WHERE id = $1`, ids[1])
	e.exec(t, `INSERT INTO settlement_intents (invoice_id, status, tx_hash) VALUES ($1, 'confirmed', $2)`, ids[1], settle)
	e.exec(t, `UPDATE invoices SET payment_status = 'expired' WHERE id = $1`, ids[2])

	// Newest first: the deposits (recorded last), then the invoices. An invoice pays 5 USDC, a deposit 1 USDC.
	dep := func(hash string) any { return "deposit " + hash }
	inv := func(i int) any { return "invoice " + ids[i] }
	checkList(t, e, "/v1/profiles/"+e.aliceProfile+"/activity", func(it map[string]any) any {
		if it["kind"] == "deposit" {
			return dep(it["txHash"].(string))
		}
		return inv(slices.Index(ids, it["invoiceId"].(string)))
	}, []listCase{
		{"status=open", []any{dep(detected), inv(0)}},
		{"status=paid", []any{dep(confirmed)}},
		{"status=settled", []any{inv(1)}},
		{"status=expired", []any{inv(2)}},
		{"q=" + strings.ToUpper(confirmed[:12]), []any{dep(confirmed)}},
		{"q=" + settle[20:40], []any{inv(1)}}, // the settle transaction
		{"q=1.0", []any{dep(detected), dep(confirmed)}},
		{"q=5", []any{inv(2), inv(1), inv(0)}},
		{"q=usd", []any{dep(detected), dep(confirmed), inv(2), inv(1), inv(0)}},
		{"status=open&q=1", []any{dep(detected)}},
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
