package tests

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// R-221, D-120: Developer mode is the profile's; what the dashboard makes takes it, and each mode lists only its own.
func TestDeveloperModeIsTheProfilesMode(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	base := "/v1/profiles/" + shop
	e.exec(t, `WITH u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:dave'), ('did:privy:erin') RETURNING id,
		    privy_user_id)
		INSERT INTO profile_members (profile_id, user_id, role)
		SELECT $1, id, CASE privy_user_id WHEN 'did:privy:dave' THEN 'admin' ELSE 'developer' END FROM u`, shop)
	mode := func(user string, live bool) reply {
		t.Helper()
		return e.call(t, "PUT", base+"/mode", user, "", fmt.Sprintf(`{"livemode": %t}`, live))
	}
	listed := func(path, field string) []any {
		t.Helper()
		r := e.call(t, "GET", base+path, alice, "", "")
		if r.status != http.StatusOK {
			t.Fatalf("GET %s: %d %v", path, r.status, r.body)
		}
		items, _ := r.body[field].([]any)
		return items
	}

	// No mainnet is on, so the profile was made in test mode.
	for _, p := range e.call(t, "GET", "/v1/me", alice, "", "").body["profiles"].([]any) {
		if p := p.(map[string]any); p["profileId"] == shop && p["livemode"] != false {
			t.Fatalf("the merchant profile on /v1/me: %v, want test mode", p)
		}
	}
	if r := mode("did:privy:erin", true); errorCode(r) != "forbidden" {
		t.Fatalf("a Developer turns Developer mode off: %d %v", r.status, r.body)
	}
	if r := mode("did:privy:dave", true); errorCode(r) != "invalid_value" {
		t.Fatalf("live mode with no mainnet on: %d %v", r.status, r.body)
	}
	e.exec(t, "UPDATE chains SET enabled = true WHERE chain_id = 8453")
	if r := mode("did:privy:dave", true); r.status != http.StatusOK || r.body["livemode"] != true {
		t.Fatalf("an Admin turns Developer mode off: %d %v", r.status, r.body)
	}

	key := func(name string) string {
		t.Helper()
		r := e.call(t, "POST", base+"/keys", alice, "", `{"name": "`+name+`", "storeId": "`+store+`",
			"scopes": ["invoices.read"]}`)
		if r.status != http.StatusCreated {
			t.Fatalf("key %s: %d %v", name, r.status, r.body)
		}
		return r.body["secret"].(string)
	}
	const hook = "6f9619ff-8b86-4011-b42d-00c04fc964ff"
	hookBody := `{"url": "https://shop.example.com/hooks", "events": ["invoice.paid"], "storeId": "` + store + `"}`
	liveKey := e.call(t, "POST", base+"/keys", alice, "", `{"name": "Live", "storeId": "`+store+`",
		"scopes": ["invoices.read"]}`)
	if secret, _ := liveKey.body["secret"].(string); !strings.HasPrefix(secret, "fw_live_") {
		t.Errorf("a key made in live mode: %d %.8s", liveKey.status, secret)
	}
	if r := e.call(t, "PUT", base+"/webhooks/"+hook, alice, "", hookBody); r.status != http.StatusCreated ||
		r.body["livemode"] != true {
		t.Fatalf("an endpoint made in live mode: %d %v", r.status, r.body)
	}

	if r := mode(alice, false); r.status != http.StatusOK {
		t.Fatalf("the owner turns Developer mode on: %d %v", r.status, r.body)
	}
	if secret := key("Test"); !strings.HasPrefix(secret, "fw_test_") {
		t.Errorf("a key made in Developer mode: %.8s", secret)
	}
	if keys := listed("/keys", "keys"); len(keys) != 1 || keys[0].(map[string]any)["name"] != "Test" {
		t.Errorf("keys in Developer mode: %v, want only the test key", keys)
	}
	if endpoints := listed("/webhooks", "endpoints"); len(endpoints) != 0 {
		t.Errorf("endpoints in Developer mode: %v, want none", endpoints)
	}
	if r := e.call(t, "PUT", base+"/webhooks/"+hook, alice, "", hookBody); r.status != http.StatusNotFound {
		t.Errorf("changing the live endpoint in Developer mode: %d %v", r.status, r.body)
	}
	// The live endpoint and key are out of reach by id too, until the mode is switched back.
	for _, c := range []struct{ method, path, body string }{
		{"GET", "/webhooks/" + hook + "/secret", ""},
		{"POST", "/webhooks/" + hook + "/secret/rotate", "{}"},
		{"GET", "/webhooks/" + hook + "/deliveries", ""},
		{"POST", "/webhooks/" + hook + "/deliveries/resend-failed", `{"since": "2026-11-01T00:00:00Z"}`},
		{"POST", "/webhooks/" + hook + "/test", "{}"},
		{"DELETE", "/webhooks/" + hook, ""},
		{"POST", "/keys/" + liveKey.body["keyId"].(string) + "/roll", "{}"},
		{"DELETE", "/keys/" + liveKey.body["keyId"].(string), ""},
	} {
		if r := e.call(t, c.method, base+c.path, alice, "", c.body); r.status != http.StatusNotFound {
			t.Errorf("%s %s in Developer mode: %d %v", c.method, c.path, r.status, r.body)
		}
	}

	mode(alice, true)
	if keys := listed("/keys", "keys"); len(keys) != 1 || keys[0].(map[string]any)["name"] != "Live" {
		t.Errorf("keys in live mode: %v, want only the live key", keys)
	}
	if endpoints := listed("/webhooks", "endpoints"); len(endpoints) != 1 {
		t.Errorf("endpoints in live mode: %v, want the live one", endpoints)
	}
}

// D-120: a new profile starts in live mode once a mainnet is on.
func TestNewProfilesStartLiveOnceAMainnetIsOn(t *testing.T) {
	e := invoiceAPI(t)
	e.exec(t, "UPDATE chains SET enabled = true WHERE chain_id = 8453")
	r := e.call(t, "POST", "/v1/profiles", "did:privy:alice", "new-live", `{"name": "Live work", "kind": "freelancer"}`)
	if r.status != http.StatusCreated || r.body["livemode"] != true {
		t.Fatalf("a profile made with Base on: %d %v", r.status, r.body)
	}
}
