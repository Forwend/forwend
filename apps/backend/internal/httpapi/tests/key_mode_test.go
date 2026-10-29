package tests

import (
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/jackc/pgx/v5"
)

// R-156, D-87: an invoice's options are all of one mode, and a key reaches only invoices of its own mode.
func TestKeyMode(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	profile := "/v1/profiles/" + e.aliceProfile
	// Arbitrum Sepolia stands in for a live chain beside test-mode Base Sepolia.
	e.enableArbUSDC(t)
	e.exec(t, "UPDATE chains SET livemode = true WHERE chain_id = 421614")
	made := e.call(t, "POST", profile+"/keys", alice, "", `{"name": "Server",
		"scopes": ["invoices.read", "invoices.write"]}`)
	key, _ := made.body["secret"].(string)
	if made.status != http.StatusCreated {
		t.Fatalf("a key: %d %v", made.status, made.body)
	}
	byKey := func(idempotencyKey, body string) reply {
		t.Helper()
		req, err := http.NewRequest(http.MethodPost, e.srv.URL+profile+"/invoices", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Idempotency-Key", idempotencyKey)
		return e.do(t, req)
	}
	chains := func(r reply) []float64 {
		t.Helper()
		var out []float64
		for _, o := range r.body["options"].([]any) {
			out = append(out, o.(map[string]any)["chainId"].(float64))
		}
		return out
	}

	// From the app, a USD invoice takes only the live options; with the test key, only the test ones. Both are overdue.
	usd := `{"amountUsd": "12.50", "dueDate": "` + time.Now().UTC().AddDate(0, 0, -3).Format(time.DateOnly) + `"}`
	app := e.post(t, alice, e.aliceProfile, "app-usd", usd)
	if app.status != http.StatusCreated || app.body["livemode"] != true || !slices.Equal(chains(app), []float64{421614}) {
		t.Fatalf("the app's USD invoice: %d %v", app.status, app.body)
	}
	test := byKey("key-usd", usd)
	if test.status != http.StatusCreated || test.body["livemode"] != false || !slices.Equal(chains(test), []float64{84532}) {
		t.Fatalf("the key's USD invoice: %d %v", test.status, test.body)
	}
	if r := byKey("key-live", `{"chainId": 421614, "token": "`+arbUSDC+`", "amount": "1"}`); errorCode(r) !=
		"invalid_value" || !strings.Contains(r.body["error"].(map[string]any)["message"].(string), "must be test mode") {
		t.Errorf("a test key's live-mode token: %d %v", r.status, r.body)
	}
	appID, testID := app.body["invoiceId"].(string), test.body["invoiceId"].(string)
	// A key's Revise of the other mode's invoice finds none, and leaves it as it was.
	if r := byKey("key-revise", `{"amountUsd": "6", "replaces": "`+appID+`"}`); errorCode(r) != "invoice_not_found" {
		t.Errorf("the test key's Revise of the live invoice: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", profile+"/invoices/"+appID, alice, "", ""); r.body["paymentStatus"] != "open" {
		t.Errorf("the live invoice after the refused Revise: %v", r.body["paymentStatus"])
	}

	// Reads with the key see only test mode; the owner sees both.
	ids := func(r reply) []string {
		t.Helper()
		if r.status != http.StatusOK {
			t.Fatalf("list: %d %v", r.status, r.body)
		}
		var out []string
		for _, it := range r.body["items"].([]any) {
			item := it.(map[string]any)
			if data, ok := item["data"].(map[string]any); ok { // a webhook event
				item = data["invoice"].(map[string]any)
			}
			out = append(out, item["invoiceId"].(string))
		}
		return out
	}
	if got := ids(e.withKey(t, "GET", profile+"/invoices", key, "")); !slices.Equal(got, []string{testID}) {
		t.Errorf("the key's list: %v, want only %s", got, testID)
	}
	if got := ids(e.call(t, "GET", profile+"/invoices", alice, "", "")); len(got) != 2 {
		t.Errorf("the owner's list: %v, want both", got)
	}
	for _, path := range []string{"", "/cancel"} {
		method := map[string]string{"": "GET", "/cancel": "POST"}[path]
		if r := e.withKey(t, method, profile+"/invoices/"+appID+path, key, ""); errorCode(r) != "invoice_not_found" {
			t.Errorf("%s the live invoice%s with the test key: %d %v", method, path, r.status, r.body)
		}
	}
	if r := e.withKey(t, "GET", profile+"/invoices/"+testID, key, ""); r.status != http.StatusOK {
		t.Errorf("GET the test invoice with the test key: %d %v", r.status, r.body)
	}

	// What's owed, the activity feed and the webhook events narrow the same way.
	if got := ids(e.withKey(t, "GET", profile+"/owed", key, "")); !slices.Equal(got, []string{testID}) {
		t.Errorf("owed with the key: %v, want only %s", got, testID)
	}
	if got := ids(e.call(t, "GET", profile+"/owed", alice, "", "")); len(got) != 2 {
		t.Errorf("owed for the owner: %v, want both", got)
	}
	e.exec(t, `INSERT INTO outbox_events (kind, invoice_id, payload)
		SELECT 'invoice.paid', id, jsonb_build_object('option', id) FROM invoices WHERE id = ANY($1)`,
		[]string{appID, testID})
	for _, id := range []string{appID, testID} {
		if r := e.call(t, "POST", profile+"/invoices/"+id+"/cancel", alice, "", ""); r.status != http.StatusOK {
			t.Fatalf("cancel %s: %d %v", id, r.status, r.body)
		}
	}
	for _, path := range []string{"/events", "/webhook-events"} {
		if got := ids(e.withKey(t, "GET", profile+path, key, "")); !slices.Equal(got, []string{testID}) {
			t.Errorf("%s with the key: %v, want only %s", path, got, testID)
		}
		if got := ids(e.call(t, "GET", profile+path, alice, "", "")); len(got) != 2 {
			t.Errorf("%s for the owner: %v, want both", path, got)
		}
	}

	// Money held for the payer, which a canceled invoice still owes, is the payer's: never owed (D-114).
	e.exec(t, `WITH t AS (INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		        block_hash, block_number, block_time, from_address, to_address, amount, status)
		    SELECT chain_id, 'evm', token_contract, id, id, 0, id, 90, extract(epoch FROM now())::bigint, $2,
		        receive_address, 1000000, 'confirmed' FROM invoices WHERE id = ANY($1) RETURNING id, invoice_id),
		     x AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
		        SELECT invoice_id, 'deposit', id FROM t RETURNING id)
		INSERT INTO ledger_entries (transaction_id, account, amount) SELECT id, 'receiver', 1000000 FROM x
		UNION ALL SELECT id, 'payer_held', -1000000 FROM x`, []string{appID, testID}, aliceWallet)
	if got := ids(e.withKey(t, "GET", profile+"/owed", key, "")); len(got) != 0 {
		t.Errorf("held money with the key: %v, want none owed", got)
	}
	if got := ids(e.call(t, "GET", profile+"/owed", alice, "", "")); len(got) != 0 {
		t.Errorf("held money for the owner: %v, want none owed", got)
	}

	// The same key in live mode replays none of its test-mode creates, and sees only live mode.
	e.exec(t, "UPDATE api_keys SET livemode = true")
	if r := byKey("key-usd", usd); errorCode(r) != "idempotency_conflict" {
		t.Errorf("a live key's replay of a test-mode create: %d %v", r.status, r.body)
	}
	if got := ids(e.withKey(t, "GET", profile+"/invoices", key, "")); !slices.Equal(got, []string{appID}) {
		t.Errorf("the live key's list: %v, want only %s", got, appID)
	}

	// A Revise keeps the mode of the invoice it replaces, and a retainer's later month the mode of its first.
	fixed := e.post(t, alice, e.aliceProfile, "app-fixed", basicBody).body["invoiceId"].(string)
	revised := e.post(t, alice, e.aliceProfile, "app-revise", `{"amountUsd": "6", "replaces": "`+fixed+`"}`)
	if revised.status != http.StatusCreated || revised.body["livemode"] != false ||
		!slices.Equal(chains(revised), []float64{84532}) {
		t.Errorf("the owner's Revise of a test-mode invoice: %d %v", revised.status, revised.body)
	}
	e.exec(t, "UPDATE api_keys SET livemode = false")
	due := time.Now().UTC().AddDate(0, -1, 3).Format(time.DateOnly)
	if r := byKey("key-retainer", `{"amountUsd": "5", "dueDate": "`+due+`", "client": {"email": "ap@bob.example"},
		"repeat": {}}`); r.status != http.StatusCreated || r.body["livemode"] != false {
		t.Fatalf("the test key's retainer: %d %v", r.status, r.body)
	}
	if err := invoice.NewService(e.pool).MakeRetainerInvoices(t.Context()); err != nil {
		t.Fatal(err)
	}
	rows, err := e.pool.Query(t.Context(), `SELECT c.livemode FROM retainer_invoices x JOIN invoices i ON i.id = x.invoice_id
		JOIN chains c ON c.chain_id = i.chain_id ORDER BY x.cycle`)
	if err != nil {
		t.Fatal(err)
	}
	if months, err := pgx.CollectRows(rows, pgx.RowTo[bool]); err != nil || !slices.Equal(months, []bool{false, false}) {
		t.Errorf("the retainer's months live %v (%v), want two in test mode", months, err)
	}
}

func TestUSDInvoiceDoesNotFallBackWhenLiveTokensAreOff(t *testing.T) {
	e := invoiceAPI(t)
	e.enableArbUSDC(t)
	e.exec(t, "UPDATE chains SET livemode = true WHERE chain_id = 421614")
	e.exec(t, `INSERT INTO profile_tokens_off (profile_id, chain_id, token_contract) VALUES ($1, 421614, $2)`,
		e.aliceProfile, arbUSDC)
	r := e.post(t, "did:privy:alice", e.aliceProfile, "no-fallback", `{"amountUsd": "5"}`)
	if r.status != http.StatusUnprocessableEntity || errorCode(r) != "invalid_value" {
		t.Fatalf("all live tokens off: %d %v, want 422", r.status, r.body)
	}
}

func TestPaymentLinksStayInTheirMode(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	path := "/v1/profiles/" + e.aliceProfile
	const testID = "aaaaaaaa-0000-4000-8000-000000000031"
	const liveID = "aaaaaaaa-0000-4000-8000-000000000032"
	test := e.call(t, "PUT", path+"/links/"+testID, alice, "", `{"title": "Test", "amountUsd": "5"}`)
	if test.status != http.StatusCreated || test.body["livemode"] != false {
		t.Fatalf("test link: %d %v", test.status, test.body)
	}
	e.enableArbUSDC(t)
	e.exec(t, "UPDATE chains SET livemode = true WHERE chain_id = 421614")
	live := e.call(t, "PUT", path+"/links/"+liveID, alice, "", `{"title": "Live", "amountUsd": "5"}`)
	if live.status != http.StatusCreated || live.body["livemode"] != true {
		t.Fatalf("live link: %d %v", live.status, live.body)
	}
	key := e.call(t, "POST", path+"/keys", alice, "", `{"name": "Test server", "scopes": ["invoices.read", "invoices.write"]}`).body["secret"].(string)
	const byKeyID = "aaaaaaaa-0000-4000-8000-000000000033"
	if r := e.withKey(t, "PUT", path+"/links/"+byKeyID, key, `{"title": "Key test", "amountUsd": "5"}`); r.status != http.StatusCreated || r.body["livemode"] != false {
		t.Fatalf("test key creates beside live networks: %d %v", r.status, r.body)
	}
	for _, method := range []string{"GET", "PUT"} {
		body := ""
		if method == "PUT" {
			body = `{"title": "Changed", "amountUsd": "5"}`
		}
		if r := e.withKey(t, method, path+"/links/"+liveID, key, body); r.status != http.StatusNotFound {
			t.Fatalf("%s live link with test key: %d %v", method, r.status, r.body)
		}
	}
	list := e.withKey(t, "GET", path+"/links", key, "")
	links, _ := list.body["links"].([]any)
	if list.status != http.StatusOK || len(links) != 2 || links[0].(map[string]any)["linkId"] != byKeyID ||
		links[1].(map[string]any)["linkId"] != testID {
		t.Fatalf("test key's links: %d %v", list.status, list.body)
	}
	if r := e.call(t, "PUT", path+"/links/"+testID, alice, "", `{"title": "Still test", "amountUsd": "5"}`); r.status != http.StatusOK || r.body["livemode"] != false {
		t.Fatalf("edited test link: %d %v", r.status, r.body)
	}
	for _, l := range []reply{test, live} {
		slug := l.body["slug"].(string)
		public := e.call(t, "GET", "/v1/links/"+slug, "", "", "")
		if public.body["livemode"] != l.body["livemode"] {
			t.Fatalf("public mode: %v, want %v", public.body, l.body["livemode"])
		}
		paid := e.call(t, "POST", "/v1/links/"+slug+"/pay", "", "pay-mode", `{}`)
		if paid.status != http.StatusCreated {
			t.Fatalf("pay: %d %v", paid.status, paid.body)
		}
		inv := e.call(t, "GET", "/v1/invoices/"+paid.body["payToken"].(string), "", "", "")
		if inv.body["livemode"] != l.body["livemode"] {
			t.Fatalf("invoice mode: %v, want %v", inv.body, l.body["livemode"])
		}
	}
	e.exec(t, "UPDATE api_keys SET livemode = true")
	list = e.withKey(t, "GET", path+"/links", key, "")
	links, _ = list.body["links"].([]any)
	if list.status != http.StatusOK || len(links) != 1 || links[0].(map[string]any)["linkId"] != liveID {
		t.Fatalf("live key's links: %d %v", list.status, list.body)
	}
	if r := e.withKey(t, "PUT", path+"/links/"+testID, key, `{"title": "Changed", "amountUsd": "5"}`); r.status != http.StatusNotFound {
		t.Fatalf("live key edits a test link: %d %v", r.status, r.body)
	}
}
