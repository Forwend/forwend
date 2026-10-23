package tests

import (
	"net/http"
	"testing"
)

// R-81.
func TestListEvents(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	other := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", basicBody).body["invoiceId"].(string)
	e.exec(t, `INSERT INTO outbox_events (kind, invoice_id, payload) VALUES
		('invoice.paid', $1, jsonb_build_object('option', $1::text)),
		('invoice.held', $1, jsonb_build_object('option', $1::text, 'amount', '700000')),
		('invoice.settled', $1, jsonb_build_object('option', $1::text))`, id)
	// Another profile's event: moved there under a lifted guard, as in the cancel tests.
	e.exec(t, `INSERT INTO outbox_events (kind, invoice_id, payload) VALUES ('invoice.paid', $1, jsonb_build_object('option', $1::text))`, other)
	e.exec(t, `ALTER TABLE invoices DISABLE TRIGGER invoices_guard`)
	e.exec(t, `UPDATE invoices SET profile_id = $2 WHERE id = $1`, other, e.walletless)
	e.exec(t, `ALTER TABLE invoices ENABLE TRIGGER invoices_guard`)

	path := "/v1/profiles/" + e.aliceProfile + "/events"
	r := e.call(t, "GET", path, "did:privy:alice", "", "")
	items, _ := r.body["items"].([]any)
	if r.status != http.StatusOK || len(items) != 3 {
		t.Fatalf("GET: %d %v, want 3 events", r.status, r.body)
	}
	for i, want := range []struct{ kind, amount string }{
		{"invoice.settled", "5000000"}, {"invoice.held", "700000"}, {"invoice.paid", "5000000"},
	} {
		it := items[i].(map[string]any)
		if it["kind"] != want.kind || it["amount"] != want.amount || it["invoiceId"] != id || it["number"] != 1.0 ||
			it["symbol"] != "USDC" || it["decimals"] != 6.0 || it["chainId"] != 84532.0 || it["at"] == "" {
			t.Fatalf("event %d: %v, want %s %s", i, it, want.kind, want.amount)
		}
	}
	if r := e.call(t, "GET", path+"?limit=1", "did:privy:alice", "", ""); len(r.body["items"].([]any)) != 1 {
		t.Fatalf("limit=1: %v", r.body)
	}
	for _, bad := range []string{"?limit=0", "?limit=51", "?limit=x"} {
		if r := e.call(t, "GET", path+bad, "did:privy:alice", "", ""); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("%s: %d, want 422", bad, r.status)
		}
	}
	if r := e.call(t, "GET", path, "did:privy:bob", "", ""); r.status != http.StatusForbidden {
		t.Fatalf("Bob: %d, want 403", r.status)
	}
	if r := e.call(t, "GET", path, "", "", ""); r.status != http.StatusUnauthorized {
		t.Fatalf("no token: %d, want 401", r.status)
	}
}

func TestListEventsOfAnOption(t *testing.T) {
	e := invoiceAPI(t)
	e.exec(t, `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES (84532, 'evm', '0x3333333333333333333333333333333333333333', 'EURC', 2, true)`)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", `{"amountUsd": "12.5"}`).body["invoiceId"].(string)
	e.exec(t, `INSERT INTO outbox_events (kind, invoice_id, payload)
		SELECT 'invoice.paid', main_id, jsonb_build_object('option', id) FROM invoices WHERE main_id = $1`, id)
	r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/events", "did:privy:alice", "", "")
	items, _ := r.body["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("events %v", r.body)
	}
	it := items[0].(map[string]any)
	if it["invoiceId"] != id || it["symbol"] == "" || it["number"] != 1.0 {
		t.Fatalf("event %v: want the invoice id and the option's token", it)
	}
	var symbol, amount string
	if err := e.pool.QueryRow(t.Context(), `SELECT t.symbol, i.amount::text FROM invoices i
		JOIN tokens t ON t.chain_id = i.chain_id AND t.contract = i.token_contract WHERE i.main_id = $1`, id).Scan(&symbol, &amount); err != nil {
		t.Fatal(err)
	}
	if it["symbol"] != symbol || it["amount"] != amount {
		t.Fatalf("event %v: want the option's %s %s", it, amount, symbol)
	}
}
