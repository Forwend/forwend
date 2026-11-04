package tests

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// R-168: only the exact origins of the invoice's store may frame its checkout, and loopback http only in test mode.
func TestEmbedAllowedOnlyForTheStoresExactOrigins(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	store := func(origins string) {
		t.Helper()
		if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+storeB, alice, "", `{"name": "Pro shop",
			"defaultExpiresIn": 3600, "allowedOrigins": `+origins+`}`); r.status != http.StatusCreated &&
			r.status != http.StatusOK {
			t.Fatalf("PUT store: %d %v", r.status, r.body)
		}
	}
	store(`["https://shop.example.com", "http://localhost:3000"]`)
	fixed := `"chainId": 84532, "token": "` + usdc + `", "amount": "1000000"`
	made := e.post(t, alice, shop, "key-1", `{`+fixed+`, "storeId": "`+storeB+`"}`)
	if made.status != http.StatusCreated {
		t.Fatalf("create: %d %v", made.status, made.body)
	}
	token := e.link(t, made.body["invoiceId"].(string))
	allowed := func(token, origin string) bool {
		t.Helper()
		r := e.call(t, "GET", "/v1/invoices/"+token+"/embed?origin="+url.QueryEscape(origin), "", "", "")
		if r.status != http.StatusOK {
			t.Fatalf("embed %q: %d %v", origin, r.status, r.body)
		}
		return r.body["allowed"] == true
	}

	for origin, want := range map[string]bool{
		"https://shop.example.com":      true,
		"http://localhost:3000":         true,
		"https://other.example.com":     false,
		"https://shop.example.com:8443": false,
		"http://shop.example.com":       false,
		"http://localhost:3001":         false,
		// Only the browser's own spelling, which goes into the header as it is.
		"https://Shop.example.com":               false,
		"https://shop.example.com/":              false,
		"https://shop.example.com:443":           false,
		"https://shop.example.com; script-src *": false,
		"":                                       false,
	} {
		if got := allowed(token, origin); got != want {
			t.Errorf("origin %q: allowed %v, want %v", origin, got, want)
		}
	}

	freelance := e.post(t, alice, e.aliceProfile, "key-2", `{`+fixed+`}`)
	if allowed(e.link(t, freelance.body["invoiceId"].(string)), "https://shop.example.com") {
		t.Error("an invoice with no store is framed")
	}
	for _, unknown := range []string{strings.Repeat("1", 64), "not-a-token"} {
		if r := e.call(t, "GET", "/v1/invoices/"+unknown+"/embed?origin=https://shop.example.com", "", "", ""); r.status !=
			http.StatusNotFound || errorCode(r) != "invoice_not_found" {
			t.Errorf("unknown token %s: %d %v", unknown, r.status, r.body)
		}
	}

	// A wildcard saved before origins were checked this strictly still frames nothing.
	e.exec(t, "UPDATE stores SET allowed_origins = allowed_origins || '{https://*}' WHERE id = $1", storeB)
	if allowed(token, "https://*") {
		t.Error("a stored wildcard frames the checkout")
	}

	e.exec(t, "UPDATE chains SET livemode = true WHERE chain_id = 84532")
	if !allowed(token, "https://shop.example.com") || allowed(token, "http://localhost:3000") {
		t.Error("a live checkout takes https origins only")
	}
	store(`["https://new.example.com"]`)
	if allowed(token, "https://shop.example.com") {
		t.Error("an origin the store removed still frames the checkout")
	}
}
