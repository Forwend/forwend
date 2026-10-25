package tests

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"
)

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

// Every route with a {profileId}; TestProfileRoutesAreAllListed fails until a new one is added here.
var profileRoutes = []struct{ method, path, body string }{
	{"PUT", "/v1/profiles/%s/billing-details", billingBody},
	{"GET", "/v1/profiles/%s/billing-details", ""},
	{"POST", "/v1/profiles/%s/invoices", basicBody},
	{"GET", "/v1/profiles/%s/invoices", ""},
	{"GET", "/v1/profiles/%s/balances", ""},
	{"GET", "/v1/profiles/%s/activity", ""},
	{"GET", "/v1/profiles/%s/transactions", ""},
	{"GET", "/v1/profiles/%s/transactions.csv", ""},
	{"GET", "/v1/profiles/%s/records-currency", ""},
	{"GET", "/v1/profiles/%s/statement.pdf?from=2026-10-01&to=2026-10-31", ""},
	{"PUT", "/v1/profiles/%s/records-currency", `{"currency": "EUR"}`},
	{"PUT", "/v1/profiles/%s/transactions/84532/0x" + strings.Repeat("0", 64) + "/0/label", `{"label": "income"}`},
	{"GET", "/v1/profiles/%s/balance-history", ""},
	{"PUT", "/v1/profiles/%s/clients/" + clientA, `{"name": "Bob Ltd"}`},
	{"GET", "/v1/profiles/%s/clients", ""},
	{"DELETE", "/v1/profiles/%s/clients/" + clientA, ""},
	{"PUT", "/v1/profiles/%s/stores/" + storeA, `{"name": "Shop", "defaultExpiresIn": 3600}`},
	{"GET", "/v1/profiles/%s/stores", ""},
	{"GET", "/v1/profiles/%s/tokens", ""},
	{"PUT", "/v1/profiles/%s/tokens", `{"off": []}`},
	{"GET", "/v1/profiles/%s/members", ""},
	{"PUT", "/v1/profiles/%s/members/00000000-0000-0000-0000-000000000000", `{"role": "admin"}`},
	{"DELETE", "/v1/profiles/%s/members/00000000-0000-0000-0000-000000000000", ""},
	{"POST", "/v1/profiles/%s/invites", `{"email": "dev@example.com", "role": "admin"}`},
	{"DELETE", "/v1/profiles/%s/invites/00000000-0000-0000-0000-000000000000", ""},
	{"POST", "/v1/profiles/%s/leave", ""},
	{"GET", "/v1/profiles/%s/links", ""},
	{"GET", "/v1/profiles/%s/links/00000000-0000-4000-8000-000000000000", ""},
	{"PUT", "/v1/profiles/%s/links/00000000-0000-4000-8000-000000000000", `{"title": "A link"}`},
	{"GET", "/v1/profiles/%s/keys", ""},
	{"POST", "/v1/profiles/%s/keys", `{"name": "Server", "scopes": ["invoices.read"]}`},
	{"POST", "/v1/profiles/%s/keys/00000000-0000-4000-8000-000000000000/roll", "{}"},
	{"DELETE", "/v1/profiles/%s/keys/00000000-0000-4000-8000-000000000000", ""},
	{"GET", "/v1/profiles/%s/webhooks", ""},
	{"PUT", "/v1/profiles/%s/webhooks/00000000-0000-4000-8000-000000000000",
		`{"url": "https://example.com/hooks", "events": ["invoice.paid"]}`},
	{"DELETE", "/v1/profiles/%s/webhooks/00000000-0000-4000-8000-000000000000", ""},
	{"GET", "/v1/profiles/%s/webhooks/00000000-0000-4000-8000-000000000000/secret", ""},
	{"POST", "/v1/profiles/%s/webhooks/00000000-0000-4000-8000-000000000000/secret/rotate", ""},
	{"PUT", "/v1/profiles/%s/stores/" + storeA + "/logo", ""},
	{"DELETE", "/v1/profiles/%s/stores/" + storeA + "/logo", ""},
	{"POST", "/v1/profiles/%s/invoices/0x" + strings.Repeat("0", 64) + "/send", ""},
	{"PUT", "/v1/profiles/%s/invoices/0x" + strings.Repeat("0", 64) + "/reminders", `{"on": false}`},
	{"PUT", "/v1/profiles/%s/invoices/0x" + strings.Repeat("0", 64) + "/details", `{}`},
	{"POST", "/v1/profiles/%s/invoices/0x" + strings.Repeat("0", 64) + "/reopen", ""},
	{"POST", "/v1/profiles/%s/invoices/0x" + strings.Repeat("0", 64) + "/repeat/stop", ""},
	{"GET", "/v1/profiles/%s/owed", ""},
	{"GET", "/v1/profiles/%s/invoices/0x" + strings.Repeat("0", 64), ""},
	{"POST", "/v1/profiles/%s/invoices/0x" + strings.Repeat("0", 64) + "/cancel", ""},
	{"GET", "/v1/profiles/%s/events", ""},
	{"GET", "/v1/profiles/%s/notifications", ""},
	{"PUT", "/v1/profiles/%s/notifications", `{"email": true}`},
	{"POST", "/v1/profiles/%s/jobs", jobBody},
	{"GET", "/v1/profiles/%s/jobs", ""},
	{"GET", "/v1/profiles/%s/jobs/00000000-0000-0000-0000-000000000000", ""},
	{"DELETE", "/v1/profiles/%s/jobs/00000000-0000-0000-0000-000000000000", ""},
	{"POST", "/v1/profiles/%s/jobs/00000000-0000-0000-0000-000000000000/payments/1/done", "{}"},
	{"POST", "/v1/profiles/%s/jobs/00000000-0000-0000-0000-000000000000/payments",
		`{"title": "Extra page", "amountUsd": "100", "dueDays": 7}`},
	{"DELETE", "/v1/profiles/%s/jobs/00000000-0000-0000-0000-000000000000/payments/3", ""},
}

func TestProfileRoutesAreAllListed(t *testing.T) {
	files, err := filepath.Glob("../*/routes.go")
	if err != nil || len(files) == 0 {
		t.Fatalf("route files %v %v", files, err)
	}
	files = append(files, "../router.go")
	registered := regexp.MustCompile(`mux\.Handle(?:Func)?\("(\w+) (/v1/profiles/\{profileId\}[^"]*)",\s*([^\n]*)`)
	// R-138: every profile route asks for a permission from the one map.
	guarded := regexp.MustCompile(`^g\.(Can|FreshSignIn)\(auth\.\w+\)`)
	for _, file := range files {
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range registered.FindAllStringSubmatch(string(src), -1) {
			if !guarded.MatchString(strings.TrimSpace(m[3])) {
				t.Errorf("%s %s (%s) asks for no permission", m[1], m[2], file)
			}
			pattern := regexp.MustCompile("^" + regexp.MustCompile(`\{\w+\}`).ReplaceAllString(m[2], `[^/]+`) + "$")
			if !slices.ContainsFunc(profileRoutes, func(r struct{ method, path, body string }) bool {
				path, _, _ := strings.Cut(fmt.Sprintf(r.path, "p"), "?")
				return r.method == m[1] && pattern.MatchString(path)
			}) {
				t.Errorf("%s %s (%s) has no case in profileRoutes", m[1], m[2], file)
			}
		}
	}
}

func TestProfilesBelongToTheirUser(t *testing.T) {
	// Each user calls every profile route here; the limit per user has its own test (TestUserRateLimit).
	e := invoiceAPIWith(t, 1000, webhookKey)
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
	if r := e.call(t, "POST", "/v1/profiles", bob, "key-1", `{"kind": "merchant"}`); r.status != http.StatusCreated ||
		r.body["profileId"] == merchant {
		t.Fatalf("Bob with Alice's key: %d %v", r.status, r.body)
	}

	// One of Alice's profiles per route in turn.
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
	for _, field := range []string{"name", "address", "country", "email"} {
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
