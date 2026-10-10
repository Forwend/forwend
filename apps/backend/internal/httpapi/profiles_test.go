package httpapi

import (
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// call sends a request as user ("" = no token) with an optional Idempotency-Key.
func (e invoiceEnv) call(t *testing.T, method, path, user, key, body string) reply {
	t.Helper()
	req, err := http.NewRequest(method, e.srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if user != "" {
		req.Header.Set("Authorization", "Bearer "+signES256(t, e.privyKey, claims(user)))
	}
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	return e.do(t, req)
}

func profilesOf(r reply) []map[string]any {
	var out []map[string]any
	list, _ := r.body["profiles"].([]any)
	for _, p := range list {
		out = append(out, p.(map[string]any))
	}
	return out
}

var walletAddress = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

func TestSignUpAndMe(t *testing.T) {
	e := invoiceAPI(t)
	const carol = "did:privy:carol"
	if r := e.call(t, "GET", "/v1/me", carol, "", ""); r.status != http.StatusNotFound || errorCode(r) != "not_signed_up" {
		t.Fatalf("GET before signup: %d %v", r.status, r.body)
	}
	first := e.call(t, "POST", "/v1/me", carol, "", "")
	profiles := profilesOf(first)
	if first.status != http.StatusCreated || len(profiles) != 1 || profiles[0]["kind"] != "personal" ||
		profiles[0]["name"] != nil || !walletAddress.MatchString(fmt.Sprint(profiles[0]["walletAddress"])) {
		t.Fatalf("signup: %d %v; want 201 with a personal profile and its wallet", first.status, first.body)
	}
	again := e.call(t, "POST", "/v1/me", carol, "", "")
	if again.status != http.StatusOK || !reflect.DeepEqual(again.body, first.body) {
		t.Fatalf("signup again: %d %v; want 200 and nothing changed", again.status, again.body)
	}
	if me := e.call(t, "GET", "/v1/me", carol, "", ""); me.status != http.StatusOK || !reflect.DeepEqual(me.body, first.body) {
		t.Fatalf("GET /v1/me: %d %v", me.status, me.body)
	}
	for _, method := range []string{"GET", "POST"} {
		if r := e.call(t, method, "/v1/me", "", "", ""); r.status != http.StatusUnauthorized {
			t.Fatalf("%s /v1/me without a token: %d", method, r.status)
		}
	}
}

func TestCreateProfileRoute(t *testing.T) {
	e := invoiceAPI(t)
	const carol = "did:privy:carol"
	body := `{"kind": "merchant", "name": "Carol's shop"}`
	if r := e.call(t, "POST", "/v1/profiles", carol, "key-1", body); r.status != http.StatusNotFound || errorCode(r) != "not_signed_up" {
		t.Fatalf("before signup: %d %v", r.status, r.body)
	}
	e.call(t, "POST", "/v1/me", carol, "", "")

	created := e.call(t, "POST", "/v1/profiles", carol, "key-1", body)
	p := created.body
	if created.status != http.StatusCreated || p["kind"] != "merchant" || p["name"] != "Carol's shop" ||
		!walletAddress.MatchString(fmt.Sprint(p["walletAddress"])) {
		t.Fatalf("create: %d %v", created.status, p)
	}
	if r := e.call(t, "POST", "/v1/profiles", carol, "key-1", `{"name": "Carol's shop", "kind": "merchant"}`); r.status != http.StatusOK ||
		!reflect.DeepEqual(r.body, p) {
		t.Fatalf("same request again: %d %v; want 200 with the stored profile", r.status, r.body)
	}
	me := profilesOf(e.call(t, "GET", "/v1/me", carol, "", ""))
	if len(me) != 2 || !reflect.DeepEqual(me[1], p) {
		t.Fatalf("GET /v1/me: %v; want the personal and the new profile", me)
	}

	for _, c := range []struct {
		key, body, code string
		status          int
	}{
		{"key-1", `{"kind": "freelancer"}`, "idempotency_conflict", http.StatusConflict},
		{"", body, "malformed_request", http.StatusBadRequest},
		{"key-2", `{"kind": "merchant", "wallet": "0x1111111111111111111111111111111111111111"}`, "malformed_request", http.StatusBadRequest},
		{"key-2", `{"kind": "personal"}`, "invalid_value", http.StatusUnprocessableEntity},
		{"key-2", `{"kind": "merchant", "name": "` + strings.Repeat("a", 65) + `"}`, "invalid_value", http.StatusUnprocessableEntity},
	} {
		if r := e.call(t, "POST", "/v1/profiles", carol, c.key, c.body); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("key %q body %s: %d %v, want %d %s", c.key, c.body, r.status, r.body, c.status, c.code)
		}
	}
	if r := e.call(t, "POST", "/v1/profiles", "", "key-3", body); r.status != http.StatusUnauthorized {
		t.Fatalf("without a token: %d", r.status)
	}
}

// profileRoutes is every route with a {profileId}; add each new one here so the cross-user test covers it.
var profileRoutes = []struct{ method, path, body string }{
	{"POST", "/v1/profiles/%s/invoices", basicBody},
	{"GET", "/v1/profiles/%s/balances", ""},
	{"GET", "/v1/profiles/%s/activity", ""},
	{"GET", "/v1/profiles/%s/transactions", ""},
	{"GET", "/v1/profiles/%s/balance-history", ""},
}

// Bob never sees Alice's profiles and gets 403 on every profile route for them; Alice passes the owner check.
func TestProfilesBelongToTheirUser(t *testing.T) {
	e := invoiceAPI(t)
	const alice, bob = "did:privy:alice", "did:privy:bob"
	e.call(t, "POST", "/v1/me", alice, "", "")
	e.call(t, "POST", "/v1/me", bob, "", "")
	merchant := e.call(t, "POST", "/v1/profiles", alice, "key-1", `{"kind": "merchant"}`).body["profileId"].(string)
	var alices []string
	for _, p := range profilesOf(e.call(t, "GET", "/v1/me", alice, "", "")) {
		alices = append(alices, p["profileId"].(string))
	}
	if len(alices) != 4 { // the fixture's freelancer and merchant, the personal, the new merchant
		t.Fatalf("Alice has %v", alices)
	}
	for _, p := range profilesOf(e.call(t, "GET", "/v1/me", bob, "", "")) {
		for _, a := range alices {
			if p["profileId"] == a {
				t.Fatalf("Bob's /v1/me lists Alice's profile %s", a)
			}
		}
	}
	// Bob's same key makes his own profile, not Alice's.
	if r := e.call(t, "POST", "/v1/profiles", bob, "key-1", `{"kind": "merchant"}`); r.status != http.StatusCreated ||
		r.body["profileId"] == merchant {
		t.Fatalf("Bob with Alice's key: %d %v", r.status, r.body)
	}

	for _, route := range profileRoutes {
		for _, id := range alices {
			path := fmt.Sprintf(route.path, id)
			if r := e.call(t, route.method, path, bob, "bob-key", route.body); r.status != http.StatusForbidden {
				t.Fatalf("Bob %s %s: %d %v, want 403", route.method, path, r.status, r.body)
			}
			if r := e.call(t, route.method, path, alice, "alice-key-"+id, route.body); r.status == http.StatusForbidden {
				t.Fatalf("Alice %s %s: 403 on her own profile", route.method, path)
			}
		}
	}
}
