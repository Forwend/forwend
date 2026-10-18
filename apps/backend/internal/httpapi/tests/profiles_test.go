package tests

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"
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

// The first-run choice makes its profiles once and sets onboardedAt, which GET and POST /v1/me return; a repeat, with
// any choices, answers 200 with the same state. Another user's token onboards only that user.
func TestOnboardingRoute(t *testing.T) {
	e := invoiceAPI(t)
	const carol, dave = "did:privy:carol", "did:privy:dave"
	const path = "/v1/me/onboarding"
	if r := e.call(t, "POST", path, carol, "", `{"choices": []}`); r.status != http.StatusNotFound || errorCode(r) != "not_signed_up" {
		t.Fatalf("before signup: %d %v", r.status, r.body)
	}
	for _, u := range []string{carol, dave} {
		if r := e.call(t, "POST", "/v1/me", u, "", ""); r.status != http.StatusCreated || r.body["onboardedAt"] != nil ||
			!reflect.DeepEqual(e.call(t, "GET", "/v1/me", u, "", "").body, r.body) {
			t.Fatalf("signup: %d %v; want onboardedAt null on POST and GET", r.status, r.body)
		}
	}

	for _, c := range []struct {
		body, code string
		status     int
	}{
		{`{}`, "invalid_value", http.StatusUnprocessableEntity},
		{`{"choices": null}`, "invalid_value", http.StatusUnprocessableEntity},
		{`{"choices": ["freelancer"]}`, "invalid_value", http.StatusUnprocessableEntity},
		{`{"choices": "get_paid_by_clients"}`, "malformed_request", http.StatusBadRequest},
		{`{"choices": [], "kind": "merchant"}`, "malformed_request", http.StatusBadRequest},
	} {
		if r := e.call(t, "POST", path, carol, "", c.body); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("body %s: %d %v, want %d %s", c.body, r.status, r.body, c.status, c.code)
		}
	}
	if r := e.call(t, "POST", path, "", "", `{"choices": []}`); r.status != http.StatusUnauthorized {
		t.Fatalf("without a token: %d", r.status)
	}

	first := e.call(t, "POST", path, carol, "", `{"choices": ["get_paid_by_clients", "build_integration"]}`)
	var kinds []string
	for _, p := range profilesOf(first) {
		if !walletAddress.MatchString(fmt.Sprint(p["walletAddress"])) {
			t.Fatalf("profile without a wallet: %v", p)
		}
		kinds = append(kinds, p["kind"].(string))
	}
	slices.Sort(kinds)
	if first.status != http.StatusCreated || !slices.Equal(kinds, []string{"freelancer", "merchant", "personal"}) {
		t.Fatalf("onboard: %d %v; want 201 with personal, freelancer and merchant", first.status, first.body)
	}
	if _, err := time.Parse(time.RFC3339, fmt.Sprint(first.body["onboardedAt"])); err != nil {
		t.Fatalf("onboardedAt %v", first.body["onboardedAt"])
	}
	again := e.call(t, "POST", path, carol, "", `{"choices": ["accept_business_payments"]}`)
	if again.status != http.StatusOK || !reflect.DeepEqual(again.body, first.body) {
		t.Fatalf("again: %d %v; want 200 and the same state", again.status, again.body)
	}
	for _, method := range []string{"GET", "POST"} {
		if me := e.call(t, method, "/v1/me", carol, "", ""); !reflect.DeepEqual(me.body, first.body) {
			t.Fatalf("%s /v1/me: %v; want the onboarded state", method, me.body)
		}
	}

	// Dave skips: no profile, his own onboardedAt; Carol's state stays as it was.
	skip := e.call(t, "POST", path, dave, "", `{"choices": []}`)
	if skip.status != http.StatusCreated || skip.body["onboardedAt"] == nil || len(profilesOf(skip)) != 1 {
		t.Fatalf("skip: %d %v; want 201 with only the personal profile", skip.status, skip.body)
	}
	for _, p := range profilesOf(skip) {
		for _, c := range profilesOf(first) {
			if p["profileId"] == c["profileId"] {
				t.Fatalf("Dave's answer lists Carol's profile %v", c)
			}
		}
	}
	if me := e.call(t, "GET", "/v1/me", carol, "", ""); !reflect.DeepEqual(me.body, first.body) {
		t.Fatalf("Carol after Dave: %v", me.body)
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
	{"PUT", "/v1/profiles/%s/billing-details", billingBody},
	{"GET", "/v1/profiles/%s/billing-details", ""},
	{"POST", "/v1/profiles/%s/invoices", basicBody},
	{"GET", "/v1/profiles/%s/invoices", ""},
	{"GET", "/v1/profiles/%s/balances", ""},
	{"GET", "/v1/profiles/%s/activity", ""},
	{"GET", "/v1/profiles/%s/transactions", ""},
	{"GET", "/v1/profiles/%s/balance-history", ""},
	{"PUT", "/v1/profiles/%s/clients/" + clientA, `{"name": "Bob Ltd"}`},
	{"GET", "/v1/profiles/%s/clients", ""},
	{"DELETE", "/v1/profiles/%s/clients/" + clientA, ""},
	{"POST", "/v1/profiles/%s/invoices/0x" + strings.Repeat("0", 64) + "/send", ""},
	{"PUT", "/v1/profiles/%s/invoices/0x" + strings.Repeat("0", 64) + "/reminders", `{"on": false}`},
	{"POST", "/v1/profiles/%s/invoices/0x" + strings.Repeat("0", 64) + "/repeat/stop", ""},
	{"GET", "/v1/profiles/%s/owed", ""},
	{"POST", "/v1/profiles/%s/jobs", jobBody},
	{"GET", "/v1/profiles/%s/jobs", ""},
	{"GET", "/v1/profiles/%s/jobs/00000000-0000-0000-0000-000000000000", ""},
	{"DELETE", "/v1/profiles/%s/jobs/00000000-0000-0000-0000-000000000000", ""},
	{"POST", "/v1/profiles/%s/jobs/00000000-0000-0000-0000-000000000000/payments/1/done", "{}"},
	{"POST", "/v1/profiles/%s/jobs/00000000-0000-0000-0000-000000000000/payments",
		`{"title": "Extra page", "amountUsd": "100", "dueDays": 7}`},
	{"DELETE", "/v1/profiles/%s/jobs/00000000-0000-0000-0000-000000000000/payments/3", ""},
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

	// Each route on one of Alice's profiles in turn, so every route and every profile is checked: each user's limit
	// (60 requests at once) can't take every pair.
	for i, route := range profileRoutes {
		id := alices[i%len(alices)]
		path := fmt.Sprintf(route.path, id)
		if r := e.call(t, route.method, path, bob, "bob-key", route.body); r.status != http.StatusForbidden {
			t.Fatalf("Bob %s %s: %d %v, want 403", route.method, path, r.status, r.body)
		}
		if r := e.call(t, route.method, path, alice, "alice-key-"+id, route.body); r.status == http.StatusForbidden {
			t.Fatalf("Alice %s %s: 403 on her own profile", route.method, path)
		}
	}
}

const billingBody = `{"name": "Alice Design GmbH", "address": "Hauptstr. 1\n10115 Berlin", "country": "DE",
	"taxId": "DE123456789", "email": "billing@alice.example"}`

// PUT saves the profile's billing details and replaces them on the next PUT; GET returns them, 404 before the first.
func TestBillingDetails(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	// The merchant profile: the freelancer one starts with billing details.
	path := "/v1/profiles/" + e.walletless + "/billing-details"
	if r := e.call(t, "GET", path, alice, "", ""); r.status != http.StatusNotFound || errorCode(r) != "billing_details_not_found" {
		t.Fatalf("GET before PUT: %d %v", r.status, r.body)
	}

	want := map[string]any{"name": "Alice Design GmbH", "address": "Hauptstr. 1\n10115 Berlin", "country": "DE",
		"taxId": "DE123456789", "email": "billing@alice.example"}
	saved := e.call(t, "PUT", path, alice, "", billingBody)
	if saved.status != http.StatusOK {
		t.Fatalf("PUT: %d %v", saved.status, saved.body)
	}
	if _, err := time.Parse(time.RFC3339, fmt.Sprint(saved.body["updatedAt"])); err != nil {
		t.Fatalf("updatedAt %v", saved.body["updatedAt"])
	}
	delete(saved.body, "updatedAt")
	if !reflect.DeepEqual(saved.body, want) {
		t.Fatalf("PUT returned %v, want %v", saved.body, want)
	}
	got := e.call(t, "GET", path, alice, "", "")
	delete(got.body, "updatedAt")
	if got.status != http.StatusOK || !reflect.DeepEqual(got.body, want) {
		t.Fatalf("GET: %d %v, want %v", got.status, got.body, want)
	}

	// A PUT replaces every field: a tax ID left out means none.
	const short = `{"name": "Alice", "address": "Rue 2, Paris", "country": "FR", "email": "a@example.com"}`
	e.call(t, "PUT", path, alice, "", short)
	got = e.call(t, "GET", path, alice, "", "")
	delete(got.body, "updatedAt")
	if want := map[string]any{"name": "Alice", "address": "Rue 2, Paris", "country": "FR", "taxId": nil,
		"email": "a@example.com"}; got.status != http.StatusOK || !reflect.DeepEqual(got.body, want) {
		t.Fatalf("GET after the second PUT: %d %v, want %v", got.status, got.body, want)
	}

	// Each case changes one field of a valid body.
	for _, c := range []struct {
		field, value, code string
		status             int
	}{
		{"name", `""`, "invalid_value", http.StatusUnprocessableEntity},
		{"address", `""`, "invalid_value", http.StatusUnprocessableEntity},
		{"country", `""`, "invalid_value", http.StatusUnprocessableEntity},
		{"email", `""`, "invalid_value", http.StatusUnprocessableEntity},
		{"email", `"not an email"`, "invalid_value", http.StatusUnprocessableEntity},
		{"email", `"Alice <a@example.com>"`, "invalid_value", http.StatusUnprocessableEntity},
		{"country", `"de"`, "invalid_value", http.StatusUnprocessableEntity},
		{"country", `"XK"`, "invalid_value", http.StatusUnprocessableEntity},
		{"country", `"DEU"`, "invalid_value", http.StatusUnprocessableEntity},
		{"name", `"` + strings.Repeat("é", 201) + `"`, "invalid_value", http.StatusUnprocessableEntity},
		{"address", `"` + strings.Repeat("a", 501) + `"`, "invalid_value", http.StatusUnprocessableEntity},
		{"taxId", `"` + strings.Repeat("1", 51) + `"`, "invalid_value", http.StatusUnprocessableEntity},
		{"email", `"` + strings.Repeat("a", 243) + `@example.com"`, "invalid_value", http.StatusUnprocessableEntity},
		{"name", `"A\u0000"`, "invalid_value", http.StatusUnprocessableEntity},
		{"phone", `"123"`, "malformed_request", http.StatusBadRequest},
		{"name", `1`, "malformed_request", http.StatusBadRequest},
	} {
		var body map[string]json.RawMessage
		if err := json.Unmarshal([]byte(short), &body); err != nil {
			t.Fatal(err)
		}
		body[c.field] = json.RawMessage(c.value)
		raw, _ := json.Marshal(body)
		if r := e.call(t, "PUT", path, alice, "", string(raw)); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("PUT %s: %d %v, want %d %s", raw, r.status, r.body, c.status, c.code)
		}
	}
	for _, field := range []string{"name", "address", "country", "email"} { // left out
		var body map[string]string
		_ = json.Unmarshal([]byte(short), &body)
		delete(body, field)
		raw, _ := json.Marshal(body)
		if r := e.call(t, "PUT", path, alice, "", string(raw)); r.status != http.StatusUnprocessableEntity ||
			errorCode(r) != "invalid_value" {
			t.Fatalf("PUT without %s: %d %v, want 422", field, r.status, r.body)
		}
	}
	if got := e.call(t, "GET", path, alice, "", ""); got.body["name"] != "Alice" {
		t.Fatalf("a refused PUT changed the details: %v", got.body)
	}
	for _, method := range []string{"GET", "PUT"} {
		if r := e.call(t, method, path, "", "", billingBody); r.status != http.StatusUnauthorized {
			t.Fatalf("%s without a token: %d", method, r.status)
		}
	}
}
