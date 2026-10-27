package tests

import (
	"context"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/ledger/ledgertest"
	"time"
)

func TestGetBalances(t *testing.T) {
	e := invoiceAPI(t)
	r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/balances", "did:privy:alice", "", "")
	want := map[string]any{
		"estimatedUsdTotal": "2.50",
		"tokens": []any{map[string]any{"chainId": float64(84532), "token": usdc, "symbol": "USDC", "decimals": float64(6),
			"wallet": "2500000", "finalizedBlock": float64(100), "pending": "0", "held": "0"}},
	}
	if r.status != http.StatusOK || !reflect.DeepEqual(r.body, want) {
		t.Fatalf("got %d %v\nwant %v", r.status, r.body, want)
	}
	// A profile without a wallet: no balance and no total, never a made-up 0.
	r = e.call(t, "GET", "/v1/profiles/"+e.walletless+"/balances", "did:privy:alice", "", "")
	tokens, _ := r.body["tokens"].([]any)
	if r.status != http.StatusOK || r.body["estimatedUsdTotal"] != nil || len(tokens) != 1 ||
		tokens[0].(map[string]any)["wallet"] != nil || tokens[0].(map[string]any)["finalizedBlock"] != nil {
		t.Fatalf("walletless: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/balances", "", "", ""); r.status != http.StatusUnauthorized {
		t.Fatalf("without a token: %d", r.status)
	}
}

func TestGetActivity(t *testing.T) {
	e := invoiceAPI(t)
	path := "/v1/profiles/" + e.aliceProfile + "/activity"
	empty := e.call(t, "GET", path, "did:privy:alice", "", "")
	if empty.status != http.StatusOK || !reflect.DeepEqual(empty.body, map[string]any{"items": []any{}, "nextCursor": nil}) {
		t.Fatalf("new profile: %d %v", empty.status, empty.body)
	}
	first := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"]
	second := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", basicBody).body["invoiceId"]

	page := e.call(t, "GET", path+"?limit=1", "did:privy:alice", "", "")
	items, _ := page.body["items"].([]any)
	cursor, _ := page.body["nextCursor"].(string)
	if page.status != http.StatusOK || len(items) != 1 || cursor == "" {
		t.Fatalf("page 1: %d %v", page.status, page.body)
	}
	item := items[0].(map[string]any)
	if item["kind"] != "invoice" || item["invoiceId"] != second || item["status"] != "open" ||
		item["settlementStatus"] != "none" || item["amount"] != "5000000" || item["token"] != usdc ||
		item["symbol"] != "USDC" || item["decimals"] != float64(6) {
		t.Fatalf("newest item %v, want the second invoice", item)
	}
	last := e.call(t, "GET", path+"?limit=1&cursor="+cursor, "did:privy:alice", "", "")
	items, _ = last.body["items"].([]any)
	if last.status != http.StatusOK || len(items) != 1 || items[0].(map[string]any)["invoiceId"] != first ||
		last.body["nextCursor"] != nil {
		t.Fatalf("page 2: %d %v", last.status, last.body)
	}

	for _, c := range []struct {
		query, code string
		status      int
	}{
		{"?limit=x", "malformed_request", http.StatusBadRequest},
		{"?limit=0", "invalid_value", http.StatusUnprocessableEntity},
		{"?limit=101", "invalid_value", http.StatusUnprocessableEntity},
		{"?cursor=nope", "invalid_value", http.StatusUnprocessableEntity},
	} {
		if r := e.call(t, "GET", path+c.query, "did:privy:alice", "", ""); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("%s: %d %v, want %d %s", c.query, r.status, r.body, c.status, c.code)
		}
	}
	if r := e.call(t, "GET", path, "", "", ""); r.status != http.StatusUnauthorized {
		t.Fatalf("without a token: %d", r.status)
	}
}

func TestGetTransactions(t *testing.T) {
	e := invoiceAPI(t)
	path := "/v1/profiles/" + e.aliceProfile + "/transactions"
	empty := e.call(t, "GET", path, "did:privy:alice", "", "")
	if empty.status != http.StatusOK || !reflect.DeepEqual(empty.body, map[string]any{"items": []any{}, "nextCursor": nil}) {
		t.Fatalf("new profile: %d %v", empty.status, empty.body)
	}
	const counterparty = "0x5555555555555555555555555555555555555555"
	hash := func(n int) string { return fmt.Sprintf("0x%064x", n) }
	for _, row := range []struct {
		n                 int
		time              int64
		direction, status string
	}{{1, 1760000000, "in", "confirmed"}, {2, 1760000060, "out", "detected"}} {
		if _, err := e.pool.Exec(context.Background(), `INSERT INTO wallet_transfers (chain_id, chain_family,
			    token_contract, wallet_address, direction, counterparty, tx_hash, log_index, block_hash, block_number,
			    block_time, amount, status)
			VALUES (84532, 'evm', $1, $2, $3, $4, $5, 0, $5, $6, $7, 1000000, $8)`,
			usdc, aliceWallet, row.direction, counterparty, hash(row.n), row.n, row.time, row.status); err != nil {
			t.Fatal(err)
		}
	}

	page := e.call(t, "GET", path+"?limit=1", "did:privy:alice", "", "")
	items, _ := page.body["items"].([]any)
	cursor, _ := page.body["nextCursor"].(string)
	want := map[string]any{"chainId": float64(84532), "token": usdc, "symbol": "USDC", "decimals": float64(6),
		"direction": "out", "amount": "1000000", "counterparty": counterparty, "txHash": hash(2), "logIndex": float64(0),
		"blockNumber": float64(2), "at": "2025-10-09T08:54:20Z", "status": "detected", "usdValue": "1.000000",
		"classification": "sent", "labelable": false, "invoice": nil, "recordsValue": nil}
	if page.status != http.StatusOK || len(items) != 1 || cursor == "" || !reflect.DeepEqual(items[0], want) {
		t.Fatalf("page 1: %d %v\nwant item %v", page.status, page.body, want)
	}
	last := e.call(t, "GET", path+"?limit=1&cursor="+cursor, "did:privy:alice", "", "")
	items, _ = last.body["items"].([]any)
	if last.status != http.StatusOK || len(items) != 1 || items[0].(map[string]any)["txHash"] != hash(1) ||
		items[0].(map[string]any)["direction"] != "in" || last.body["nextCursor"] != nil {
		t.Fatalf("page 2: %d %v", last.status, last.body)
	}

	for _, c := range []struct {
		query, code string
		status      int
	}{
		{"?limit=x", "malformed_request", http.StatusBadRequest},
		{"?limit=0", "invalid_value", http.StatusUnprocessableEntity},
		{"?limit=101", "invalid_value", http.StatusUnprocessableEntity},
		{"?cursor=nope", "invalid_value", http.StatusUnprocessableEntity},
	} {
		if r := e.call(t, "GET", path+c.query, "did:privy:alice", "", ""); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("%s: %d %v, want %d %s", c.query, r.status, r.body, c.status, c.code)
		}
	}
	if r := e.call(t, "GET", path, "", "", ""); r.status != http.StatusUnauthorized {
		t.Fatalf("without a token: %d", r.status)
	}
}

func TestGetBalanceHistory(t *testing.T) {
	e := invoiceAPI(t)
	path := "/v1/profiles/" + e.aliceProfile + "/balance-history"
	r := e.call(t, "GET", path+"?days=2", "did:privy:alice", "", "")
	points, _ := r.body["points"].([]any)
	wantTokens := []any{map[string]any{"chainId": float64(84532), "token": usdc, "symbol": "USDC", "decimals": float64(6),
		"balances": []any{"2500000", "2500000"}, "received": []any{"0", "0"}, "sent": []any{"0", "0"}}}
	if r.status != http.StatusOK || len(points) != 2 || !reflect.DeepEqual(r.body["tokens"], wantTokens) {
		t.Fatalf("got %d %v\nwant tokens %v", r.status, r.body, wantTokens)
	}
	first, now := points[0].(map[string]any), points[1].(map[string]any)
	day, _ := time.Parse(time.RFC3339, first["at"].(string))
	at, _ := time.Parse(time.RFC3339, now["at"].(string))
	if !day.Equal(day.Truncate(24*time.Hour)) || time.Since(at) > time.Minute || at.Sub(day) > 24*time.Hour ||
		now["estimatedUsd"] != "2.50" || now["receivedUsd"] != "0.00" || now["sentUsd"] != "0.00" {
		t.Fatalf("points %v; want the end of yesterday (00:00 UTC), then now at 2.50 USD", points)
	}

	if r := e.call(t, "GET", path, "did:privy:alice", "", ""); r.status != http.StatusOK || len(r.body["points"].([]any)) != 30 {
		t.Fatalf("default: %d %v; want 30 days", r.status, r.body)
	}
	// A profile without a wallet: null series and totals, never a made-up 0.
	r = e.call(t, "GET", "/v1/profiles/"+e.walletless+"/balance-history?days=1", "did:privy:alice", "", "")
	tokens, _ := r.body["tokens"].([]any)
	points, _ = r.body["points"].([]any)
	if r.status != http.StatusOK || len(tokens) != 1 || tokens[0].(map[string]any)["balances"] != nil ||
		tokens[0].(map[string]any)["received"] != nil || len(points) != 1 || points[0].(map[string]any)["estimatedUsd"] != nil {
		t.Fatalf("walletless: %d %v", r.status, r.body)
	}

	for _, c := range []struct {
		query, code string
		status      int
	}{
		{"?days=x", "malformed_request", http.StatusBadRequest},
		{"?days=0", "invalid_value", http.StatusUnprocessableEntity},
		{"?days=366", "invalid_value", http.StatusUnprocessableEntity},
	} {
		if r := e.call(t, "GET", path+c.query, "did:privy:alice", "", ""); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("%s: %d %v, want %d %s", c.query, r.status, r.body, c.status, c.code)
		}
	}
	if r := e.call(t, "GET", path, "", "", ""); r.status != http.StatusUnauthorized {
		t.Fatalf("without a token: %d", r.status)
	}
}

// R-108.
func TestTransactionRecords(t *testing.T) {
	e := invoiceAPI(t)
	const alice, stranger = "did:privy:alice", "0x5555555555555555555555555555555555555555"
	path := "/v1/profiles/" + e.aliceProfile + "/transactions"
	made := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices", alice, "inv-1",
		`{"chainId": 84532, "token": "`+usdc+`", "amount": "5000000", "client": {"name": "=Bob Ltd;=1+1;\"=2+2"}}`)
	if made.status != http.StatusCreated {
		t.Fatalf("invoice: %d %v", made.status, made.body)
	}
	invoice := made.body["invoiceId"].(string)
	hash := func(n int) string { return fmt.Sprintf("0x%064x", n) }
	for _, row := range []struct {
		n            int
		counterparty string
		amount       string
	}{{1, made.body["receiveAddress"].(string), "5000000"}, {2, stranger, "1500000"}} {
		if _, err := e.pool.Exec(context.Background(), `INSERT INTO wallet_transfers (chain_id, chain_family,
			    token_contract, wallet_address, direction, counterparty, tx_hash, log_index, block_hash, block_number,
			    block_time, amount, status)
			VALUES (84532, 'evm', $1, $2, 'in', $3, $4, 0, $4, $5, 1760000000 + $5::bigint, $6, 'confirmed')`,
			usdc, aliceWallet, row.counterparty, hash(row.n), row.n, row.amount); err != nil {
			t.Fatal(err)
		}
	}
	ledgertest.Settlement(t, e.pool, invoice, hash(1), false)
	items := e.call(t, "GET", path, alice, "", "").body["items"].([]any)
	paid, other := items[1].(map[string]any), items[0].(map[string]any)
	if paid["classification"] != "invoice" || paid["usdValue"] != "5.000000" || paid["labelable"] != false ||
		!reflect.DeepEqual(paid["invoice"],
			map[string]any{"invoiceId": invoice, "number": float64(1), "clientName": "=Bob Ltd;=1+1;\"=2+2"}) {
		t.Fatalf("the invoice payment %v", paid)
	}
	if other["classification"] != "unclassified" || other["usdValue"] != "1.500000" || other["labelable"] != true ||
		other["invoice"] != nil {
		t.Fatalf("money in from a stranger %v", other)
	}

	label := func(n int, body string) reply {
		return e.call(t, "PUT", fmt.Sprintf("%s/84532/%s/0/label", path, hash(n)), alice, "", body)
	}
	if r := label(2, `{"label": "income"}`); r.status != http.StatusNoContent {
		t.Fatalf("label: %d %v", r.status, r.body)
	}
	if got := e.call(t, "GET", path, alice, "", "").body["items"].([]any)[0].(map[string]any); got["classification"] != "income" ||
		got["labelable"] != true {
		t.Fatalf("labelled %v, want income and still labelable", got)
	}
	for _, c := range []struct {
		n          int
		body, code string
		status     int
	}{
		{1, `{"label": "income"}`, "not_labelable", http.StatusConflict},
		{9, `{"label": "income"}`, "transaction_not_found", http.StatusNotFound},
		{2, `{"label": "salary"}`, "invalid_value", http.StatusUnprocessableEntity},
	} {
		if r := label(c.n, c.body); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("label %d %s: %d %v, want %d %s", c.n, c.body, r.status, r.body, c.status, c.code)
		}
	}
	for _, bad := range []string{"/x/" + hash(2) + "/0", "/9223372036854775808/" + hash(2) + "/0",
		"/84532/" + hash(2) + "/9223372036854775808"} {
		if r := e.call(t, "PUT", path+bad+"/label", alice, "", `{"label": null}`); r.status != http.StatusNotFound {
			t.Fatalf("%s: %d %v, want 404", bad, r.status, r.body)
		}
	}

	export := e.call(t, "GET", path+".csv", alice, "", "")
	want := "Date (UTC),Direction,Amount,Token,Network,Counterparty,Transaction,Status,USD value,Classification,Invoice,Client,Payment ID\r\n" +
		"2025-10-09T08:53:22Z,in,1.500000,USDC,Base Sepolia," + stranger + "," + hash(2) + ",confirmed,1.500000,income,,,\r\n" +
		"2025-10-09T08:53:21Z,in,5.000000,USDC,Base Sepolia," + made.body["receiveAddress"].(string) + "," + hash(1) +
		// A spreadsheet that splits on ";" would run what follows it too, also after a quote (R-108).
		",confirmed,5.000000,invoice,INV-0001,\"'=Bob Ltd;'=1+1;'\"\"=2+2\"," + invoice + "\r\n"
	if export.status != http.StatusOK || export.raw != want {
		t.Fatalf("export: %d\n%s\nwant\n%s", export.status, export.raw, want)
	}
	if r := e.call(t, "GET", path+".csv?from=2025-10-10", alice, "", ""); r.status != http.StatusOK ||
		strings.Count(r.raw, "\r\n") != 1 {
		t.Fatalf("export from the next day: %d %q, want the header alone", r.status, r.raw)
	}
	for _, query := range []string{"?from=x", "?to=2025-13-01", "?from=2025-10-10&to=2025-10-09"} {
		if r := e.call(t, "GET", path+".csv"+query, alice, "", ""); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("export %s: %d %v, want 422", query, r.status, r.body)
		}
	}

	// R-110: in EUR too, at the ECB's rate of the latest day on or before each transfer's.
	e.exec(t, "INSERT INTO ecb_rates (currency, day, per_eur) VALUES ('USD', '2025-10-08', 1.25)")
	currency := "/v1/profiles/" + e.aliceProfile + "/records-currency"
	if r := e.call(t, "GET", currency, alice, "", ""); r.status != http.StatusOK || r.body["currency"] != nil {
		t.Fatalf("records currency before: %d %v", r.status, r.body)
	}
	for _, bad := range []string{`{"currency": "USD"}`, `{"currency": "XXX"}`} {
		if r := e.call(t, "PUT", currency, alice, "", bad); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("%s: %d %v, want 422", bad, r.status, r.body)
		}
	}
	if r := e.call(t, "PUT", currency, alice, "", `{"currency": "EUR"}`); r.status != http.StatusOK || r.body["currency"] != "EUR" {
		t.Fatalf("set EUR: %d %v", r.status, r.body)
	}
	valued := e.call(t, "GET", path, alice, "", "").body["items"].([]any)
	if got := valued[1].(map[string]any)["recordsValue"]; !reflect.DeepEqual(got,
		map[string]any{"currency": "EUR", "amount": "4.00", "rateDate": "2025-10-08"}) {
		t.Fatalf("the invoice payment in EUR %v", got)
	}
	inEUR := e.call(t, "GET", path+".csv", alice, "", "").raw
	if lines := strings.Split(inEUR, "\r\n"); !strings.HasSuffix(lines[0], ",Client,EUR value,ECB rate date,Payment ID") ||
		!strings.HasSuffix(lines[1], ",income,,,1.20,2025-10-08,") {
		t.Fatalf("export in EUR:\n%s", inEUR)
	}
	if r := e.call(t, "PUT", currency, alice, "", `{"currency": null}`); r.status != http.StatusOK || r.body["currency"] != nil {
		t.Fatalf("clear: %d %v", r.status, r.body)
	}
}

// R-112.
func TestStatement(t *testing.T) {
	e := invoiceAPI(t)
	const alice, stranger = "did:privy:alice", "0x5555555555555555555555555555555555555555"
	made := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices", alice, "inv-1",
		`{"chainId": 84532, "token": "`+usdc+`", "amount": "5000000", "client": {"name": "Bob Ltd"}}`)
	if made.status != http.StatusCreated {
		t.Fatalf("invoice: %d %v", made.status, made.body)
	}
	add := func(n int, at time.Time, direction, counterparty, amount, status string) string {
		t.Helper()
		hash := fmt.Sprintf("0x%064x", n)
		e.exec(t, `INSERT INTO wallet_transfers (chain_id, chain_family, token_contract, wallet_address, direction,
			    counterparty, tx_hash, log_index, block_hash, block_number, block_time, amount, status)
			VALUES (84532, 'evm', $1, $2, $3, $4, $5, 0, $5, $6::bigint, $7, $8, $9)`,
			usdc, aliceWallet, direction, counterparty, hash, n, at.Unix(), amount, status)
		return hash
	}
	day := func(d, h int) time.Time { return time.Date(2025, 10, d, h, 0, 0, 0, time.UTC) }
	paid := add(1, day(9, 10), "in", made.body["receiveAddress"].(string), "5000000", "confirmed")
	income := add(2, day(9, 12), "in", stranger, "1234567", "confirmed")
	add(3, day(10, 9), "in", stranger, "2000000", "confirmed")   // unclassified
	add(4, day(10, 10), "out", stranger, "1000000", "confirmed") // money out
	add(5, day(10, 11), "in", stranger, "3000000", "detected")   // still confirming
	ledgertest.Settlement(t, e.pool, made.body["invoiceId"].(string), paid, false)
	late := add(6, day(20, 9), "in", stranger, "1000000", "confirmed")          // labelled income, no ECB rate within 7 days
	add(7, day(1, 0).Add(-time.Second), "in", stranger, "9000000", "confirmed") // before the period
	// Two half cents: the total adds the rounded lines, 1.01 twice, never the rounded sum 2.01.
	halfA := add(8, day(11, 9), "in", stranger, "1005000", "confirmed")
	halfB := add(9, day(11, 10), "in", stranger, "1005000", "confirmed")
	label := func(hash string) {
		t.Helper()
		if r := e.call(t, "PUT", fmt.Sprintf("/v1/profiles/%s/transactions/84532/%s/0/label", e.aliceProfile, hash),
			alice, "", `{"label": "income"}`); r.status != http.StatusNoContent {
			t.Fatalf("label: %d %v", r.status, r.body)
		}
	}
	label(income)
	label(late)
	label(halfA)
	label(halfB)
	label(fmt.Sprintf("0x%064x", 5)) // still confirming: labelled, but no income yet
	e.exec(t, "INSERT INTO ecb_rates (currency, day, per_eur) VALUES ('USD', '2025-10-08', 1.25)")
	if r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/records-currency", alice, "", `{"currency": "EUR"}`); r.status != http.StatusOK {
		t.Fatalf("records currency: %d %v", r.status, r.body)
	}

	path := "/v1/profiles/" + e.aliceProfile + "/statement.pdf"
	got := e.call(t, "GET", path+"?from=2025-10-01&to=2025-10-31", alice, "", "")
	if got.status != http.StatusOK || !strings.HasPrefix(got.raw, "%PDF-") {
		t.Fatalf("statement: %d %.40q", got.status, got.raw)
	}
	text := pdfText(t, []byte(got.raw))
	mustContain(t, text, "Statement", "2025-10-01 to 2025-10-31", "ACCOUNT HOLDER", "Alice Design GmbH",
		"Tax ID DE123456789", "EUR",
		"2025-10-09 10:00", "INV-0001 · Bob Ltd", "5.00", "4.00", "5.00 USDC on Base Sepolia", paid,
		"2025-10-09 12:00", "Income", "1.23", "0.99", "1.234567 USDC on Base Sepolia", income,
		"2025-10-20 09:00", "no rate", late,
		"Total", "9.25", "—",
		"no EUR value, so the EUR total is left out", "1 payment in is unclassified and not listed")
	for _, never := range []string{fmt.Sprintf("0x%064x", 3), fmt.Sprintf("0x%064x", 4), fmt.Sprintf("0x%064x", 5),
		fmt.Sprintf("0x%064x", 7)} {
		if strings.Contains(text, never) {
			t.Fatalf("the statement lists %s:\n%s", never, text)
		}
	}
	if strings.Index(text, paid) > strings.Index(text, income) || strings.Index(text, income) > strings.Index(text, late) {
		t.Fatalf("not oldest first:\n%s", text)
	}

	// Days whose lines all have a rate: the EUR total adds the rounded lines too (0.80 twice, never 1.61).
	half := pdfText(t, []byte(e.call(t, "GET", path+"?from=2025-10-11&to=2025-10-11", alice, "", "").raw))
	mustContain(t, half, "2025-10-11 to 2025-10-11", "1.01", "0.80", "Total", "2.02", "1.60")
	if strings.Contains(half, "—") || strings.Contains(half, "left out") || strings.Contains(half, income) {
		t.Fatalf("one day with rates:\n%s", half)
	}

	for _, query := range []string{"", "?from=2025-10-01", "?to=2025-10-31", "?from=2025-10-31&to=2025-10-01", "?from=x&to=y"} {
		if r := e.call(t, "GET", path+query, alice, "", ""); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("statement %q: %d %v, want 422", query, r.status, r.body)
		}
	}
	if r := e.call(t, "GET", "/v1/profiles/"+e.walletless+"/statement.pdf?from=2025-10-01&to=2025-10-31", alice, "", ""); r.status != http.StatusNotFound ||
		errorCode(r) != "billing_details_not_found" {
		t.Fatalf("without billing details: %d %v", r.status, r.body)
	}
}
