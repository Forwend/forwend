package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

const (
	storeA = "33333333-3333-4333-8333-333333333333"
	storeB = "44444444-4444-4444-8444-444444444444"
)

// merchant makes Alice a merchant profile with a wallet and billing details, so it can invoice; its first store came
// with it.
func (e invoiceEnv) merchant(t *testing.T) string {
	t.Helper()
	var id string
	err := e.pool.QueryRow(context.Background(), `
		WITH p AS (INSERT INTO profiles (user_id, kind, name)
		           SELECT id, 'merchant', 'Alice Shop' FROM users WHERE privy_user_id = 'did:privy:alice' RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'fixture-merchant-wallet', 'evm', '0x5555555555555555555555555555555555555555' FROM p),
		     b AS (INSERT INTO profile_billing_details (profile_id, name, address, country, contact_email)
		           SELECT id, 'Alice Shop Ltd', 'Main St 1', 'DE', 'shop@alice.example' FROM p)
		SELECT id::text FROM p`).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// R-134.
func TestStores(t *testing.T) {
	e := invoiceAPI(t)
	const alice, bob = "did:privy:alice", "did:privy:bob"
	shop := e.merchant(t)
	path := "/v1/profiles/" + shop + "/stores"
	list := func(user string) reply { return e.call(t, "GET", path, user, "", "") }
	stores := func(r reply) []any { s, _ := r.body["stores"].([]any); return s }

	first := stores(list(alice))
	if len(first) != 1 {
		t.Fatalf("a new merchant profile's stores: %v", first)
	}
	got := first[0].(map[string]any)
	delete(got, "storeId")
	delete(got, "updatedAt")
	if want := map[string]any{"name": "Alice Shop", "defaultExpiresIn": float64(604800),
		"allowedOrigins": []any{}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("the first store is %v, want %v", got, want)
	}

	body := `{"name": " Pro shop ", "defaultExpiresIn": 3600,
		"allowedOrigins": ["https://Shop.Example.com/", "https://shop.example.com:443", " https://dev.example.com:8443"]}`
	made := e.call(t, "PUT", path+"/"+storeB, alice, "", body)
	if made.status != http.StatusCreated {
		t.Fatalf("PUT new: %d %v", made.status, made.body)
	}
	delete(made.body, "updatedAt")
	want := map[string]any{"storeId": storeB, "name": "Pro shop", "defaultExpiresIn": float64(3600),
		"allowedOrigins": []any{"https://shop.example.com", "https://dev.example.com:8443"}}
	if !reflect.DeepEqual(made.body, want) {
		t.Fatalf("PUT returned %v, want %v", made.body, want)
	}
	if again := e.call(t, "PUT", path+"/"+storeB, alice, "", body); again.status != http.StatusOK {
		t.Fatalf("PUT again: %d %v", again.status, again.body)
	}
	if got := stores(list(alice)); len(got) != 2 || got[1].(map[string]any)["storeId"] != storeB {
		t.Fatalf("list, the first store first: %v", got)
	}
	if r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/stores", alice, "", ""); r.status != http.StatusOK ||
		len(stores(r)) != 0 {
		t.Fatalf("a freelancer profile's stores: %d %v", r.status, r.body)
	}

	if r := list(bob); r.status != http.StatusForbidden {
		t.Fatalf("Bob lists Alice's stores: %d", r.status)
	}
	if r := e.call(t, "PUT", path+"/"+storeA, bob, "", body); r.status != http.StatusForbidden {
		t.Fatalf("Bob saves a store on Alice's profile: %d", r.status)
	}
	if r := e.call(t, "PUT", path+"/"+storeA, "", "", body); r.status != http.StatusUnauthorized {
		t.Fatalf("PUT without a token: %d", r.status)
	}
	other := "/v1/profiles/" + e.walletless + "/stores/" + storeB
	if r := e.call(t, "PUT", other, alice, "", body); r.status != http.StatusNotFound || errorCode(r) != "store_not_found" {
		t.Fatalf("another profile saves over the store id: %d %v", r.status, r.body)
	}
	for _, p := range []string{e.aliceProfile, e.bobProfile} {
		user := alice
		if p == e.bobProfile {
			user = bob
		}
		if r := e.call(t, "PUT", "/v1/profiles/"+p+"/stores/"+storeA, user, "", body); r.status != http.StatusConflict ||
			errorCode(r) != "not_merchant" {
			t.Fatalf("a store on a %s profile: %d %v", p, r.status, r.body)
		}
	}

	for _, c := range []struct {
		field, value, code string
		status             int
	}{
		{"name", `""`, "invalid_value", http.StatusUnprocessableEntity},
		{"name", `"` + strings.Repeat("é", 65) + `"`, "invalid_value", http.StatusUnprocessableEntity},
		{"name", `"Shop\nTwo"`, "invalid_value", http.StatusUnprocessableEntity},
		{"name", `"Forwend"`, "invalid_value", http.StatusUnprocessableEntity},
		{"defaultExpiresIn", `899`, "invalid_value", http.StatusUnprocessableEntity},
		{"defaultExpiresIn", `31536001`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", `["http://shop.example.com"]`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", `["https://shop.example.com/thanks"]`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", `["https://shop.example.com?a=1"]`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", `["https://shop.example.com?"]`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", `["https://shop.example.com#top"]`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", `["https://shop.example.com#"]`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", `["https://ann@shop.example.com"]`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", `["https://bücher.example"]`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", `["shop.example.com"]`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", `["https:shop.example.com"]`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", `["https://` + strings.Repeat("a", 300) + `.example"]`, "invalid_value", http.StatusUnprocessableEntity},
		{"allowedOrigins", manyOrigins(21), "invalid_value", http.StatusUnprocessableEntity},
		{"logo", `"x"`, "malformed_request", http.StatusBadRequest},
	} {
		body := map[string]json.RawMessage{"name": json.RawMessage(`"Carol"`),
			"defaultExpiresIn": json.RawMessage(`3600`)}
		body[c.field] = json.RawMessage(c.value)
		raw, _ := json.Marshal(body)
		if r := e.call(t, "PUT", path+"/"+storeA, alice, "", string(raw)); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("PUT %s: %d %v, want %d %s", raw, r.status, r.body, c.status, c.code)
		}
	}
	if r := e.call(t, "PUT", path+"/"+storeA, alice, "", `{"name": "Carol", "defaultExpiresIn": 3600,
		"allowedOrigins": `+manyOrigins(20)+`}`); r.status != http.StatusCreated {
		t.Fatalf("PUT 20 origins: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path+"/not-a-uuid", alice, "", body); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("PUT with a malformed id: %d %v", r.status, r.body)
	}

	if _, err := e.pool.Exec(context.Background(), `INSERT INTO stores (profile_id, name)
		SELECT $1, 'filler ' || n FROM generate_series(1, 17) n`, shop); err != nil {
		t.Fatal(err)
	}
	if r := e.call(t, "PUT", path+"/"+clientA, alice, "", body); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("PUT the 21st store: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path+"/"+storeB, alice, "", body); r.status != http.StatusOK {
		t.Fatalf("PUT an existing store when full: %d %v", r.status, r.body)
	}
}

func manyOrigins(n int) string {
	origins := make([]string, n)
	for i := range origins {
		origins[i] = `"https://s` + strings.Repeat("x", i) + `.example"`
	}
	return "[" + strings.Join(origins, ", ") + "]"
}

// R-134: the store, its default close and its origins.
func TestMerchantInvoicesRecordTheirStore(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	firstStore := storeIDs(t, e, shop)[0]
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+storeB, alice, "", `{"name": "Pro shop",
		"defaultExpiresIn": 3600, "allowedOrigins": ["https://shop.example.com"]}`); r.status != http.StatusCreated {
		t.Fatalf("PUT store: %d %v", r.status, r.body)
	}
	fixed := `"chainId": 84532, "token": "` + usdc + `", "amount": "1"`
	closesIn := func(r reply) time.Duration {
		t.Helper()
		expires, _ := time.Parse(time.RFC3339, r.body["expiresAt"].(string))
		created, _ := time.Parse(time.RFC3339, r.body["createdAt"].(string))
		return expires.Sub(created).Round(time.Minute)
	}
	store := func(r reply) any { return r.body["store"] }

	first := e.post(t, alice, shop, "key-1", `{`+fixed+`}`)
	if first.status != http.StatusCreated || closesIn(first) != 7*24*time.Hour ||
		!reflect.DeepEqual(store(first), map[string]any{"storeId": firstStore, "name": "Alice Shop"}) {
		t.Fatalf("without storeId: %d, closes in %v, store %v", first.status, closesIn(first), store(first))
	}
	pro := e.post(t, alice, shop, "key-2", `{`+fixed+`, "storeId": "`+storeB+`",
		"returnUrl": "https://SHOP.example.com:443/thanks?order=1"}`)
	if pro.status != http.StatusCreated || closesIn(pro) != time.Hour ||
		!reflect.DeepEqual(store(pro), map[string]any{"storeId": storeB, "name": "Pro shop"}) {
		t.Fatalf("with storeId: %d, closes in %v, %v", pro.status, closesIn(pro), pro.body)
	}
	if r := e.post(t, alice, shop, "key-3", `{`+fixed+`, "storeId": "`+storeB+`", "expiresIn": 900}`); r.status !=
		http.StatusCreated || closesIn(r) != 15*time.Minute {
		t.Fatalf("expiresIn wins over the store's default: %d, closes in %v", r.status, closesIn(r))
	}
	if r := e.post(t, alice, shop, "key-2", `{`+fixed+`, "storeId": "`+storeB+`",
		"returnUrl": "https://SHOP.example.com:443/thanks?order=1"}`); r.status != http.StatusOK ||
		r.body["invoiceId"] != pro.body["invoiceId"] {
		t.Fatalf("the same request again: %d %v", r.status, r.body)
	}
	if r := e.post(t, alice, shop, "key-1", `{`+fixed+`, "storeId": "`+storeB+`"}`); r.status != http.StatusConflict {
		t.Fatalf("the same key with another store: %d %v", r.status, r.body)
	}

	for name, c := range map[string]struct{ profile, body string }{
		"another profile's store":      {shop, `{` + fixed + `, "storeId": "` + storeIDs(t, e, e.walletless)[0] + `"}`},
		"an unknown store":             {shop, `{` + fixed + `, "storeId": "` + storeA + `"}`},
		"a malformed store id":         {shop, `{` + fixed + `, "storeId": "shop"}`},
		"a store on a freelancer":      {e.aliceProfile, `{` + fixed + `, "storeId": "` + storeB + `"}`},
		"a link outside the origins":   {shop, `{` + fixed + `, "storeId": "` + storeB + `", "returnUrl": "https://shop.example.org/"}`},
		"a link off the origin's port": {shop, `{` + fixed + `, "storeId": "` + storeB + `", "returnUrl": "https://shop.example.com:8443/"}`},
		"a store without origins":      {shop, `{` + fixed + `, "returnUrl": "https://shop.example.com/"}`},
	} {
		if r := e.post(t, alice, c.profile, "key-"+name, c.body); r.status != http.StatusUnprocessableEntity ||
			errorCode(r) != "invalid_value" {
			t.Fatalf("%s: %d %v", name, r.status, r.body)
		}
	}
	if r := e.post(t, alice, e.aliceProfile, "key-4", `{`+fixed+`, "returnUrl": "https://anywhere.example/"}`); r.status !=
		http.StatusCreated || r.body["store"] != nil {
		t.Fatalf("a freelancer's invoice: %d %v", r.status, r.body)
	}

	listed := e.call(t, "GET", "/v1/profiles/"+shop+"/invoices", alice, "", "")
	items, _ := listed.body["items"].([]any)
	if len(items) != 3 || !reflect.DeepEqual(items[1].(map[string]any)["store"], store(pro)) ||
		!reflect.DeepEqual(items[2].(map[string]any)["store"], store(first)) {
		t.Fatalf("the list names each store: %v", items)
	}
	if r := e.get(t, pro.body["invoiceId"].(string)); r.status != http.StatusOK || r.body["store"] != nil {
		t.Fatalf("the public read names the store: %v", r.body)
	}

	details := "/v1/profiles/" + shop + "/invoices/" + pro.body["invoiceId"].(string) + "/details"
	if r := e.call(t, "PUT", details, alice, "", `{"returnUrl": "https://elsewhere.example/"}`); r.status !=
		http.StatusUnprocessableEntity {
		t.Fatalf("edit to a link outside the origins: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+storeB, alice, "", `{"name": "Pro shop",
		"defaultExpiresIn": 3600, "allowedOrigins": ["https://new.example.com"]}`); r.status != http.StatusOK {
		t.Fatalf("PUT store: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", details, alice, "", `{"memo": "VIP", "returnUrl": "https://SHOP.example.com:443/thanks?order=1"}`); r.status !=
		http.StatusOK {
		t.Fatalf("a link the store no longer allows stays: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", details, alice, "", `{"returnUrl": "https://new.example.com/done"}`); r.status != http.StatusOK ||
		r.body["returnUrl"] != "https://new.example.com/done" {
		t.Fatalf("edit to an allowed link: %d %v", r.status, r.body)
	}

	if _, err := e.pool.Exec(context.Background(), "UPDATE invoices SET store_id = $1 WHERE id = $2", firstStore,
		pro.body["invoiceId"]); err == nil || !strings.Contains(err.Error(), "store never changes") {
		t.Fatalf("moving an invoice to another store: %v", err)
	}
}

func storeIDs(t *testing.T, e invoiceEnv, profile string) []string {
	t.Helper()
	rows, err := e.pool.Query(context.Background(), "SELECT id::text FROM stores WHERE profile_id = $1 ORDER BY created_at, id",
		profile)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	return ids
}
