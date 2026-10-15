package tests

import (
	"net/http"
	"testing"
)

// R-80: the owner's email goes to the account's verified login email, read from Privy once on POST /v1/me; the
// profile turns it on or off, and no request can name another address.
func TestNotificationsUseTheLoginEmail(t *testing.T) {
	e := invoiceAPI(t)
	const dave = "did:privy:dave"
	e.wallets.Lock()
	e.wallets.Emails[dave] = "Dave@Example.com"
	e.wallets.Unlock()
	if r := e.call(t, "POST", "/v1/me", dave, "", ""); r.status != http.StatusCreated {
		t.Fatalf("sign up: %d %v", r.status, r.body)
	}
	e.wallets.Lock()
	e.wallets.Emails[dave] = "changed@example.com" // read once: a later change is not picked up on every load
	e.wallets.Unlock()
	if r := e.call(t, "POST", "/v1/me", dave, "", ""); r.status != http.StatusOK {
		t.Fatalf("second load: %d %v", r.status, r.body)
	}
	e.wallets.Lock()
	reads := e.wallets.UserReads
	e.wallets.Unlock()
	if reads != 1 {
		t.Fatalf("Privy user reads %d, want 1", reads)
	}
	profile := e.call(t, "GET", "/v1/me", dave, "", "").body["profiles"].([]any)[0].(map[string]any)["profileId"].(string)
	path := "/v1/profiles/" + profile + "/notifications"

	if r := e.call(t, "GET", path, dave, "", ""); r.status != http.StatusOK || r.body["email"] != true ||
		r.body["address"] != "dave@example.com" {
		t.Fatalf("GET: %d %v, want on and the login email", r.status, r.body)
	}
	if r := e.call(t, "PUT", path, dave, "", `{"email": false}`); r.status != http.StatusOK || r.body["email"] != false {
		t.Fatalf("PUT off: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", path, dave, "", ""); r.body["email"] != false {
		t.Fatalf("after off: %v", r.body)
	}
	if r := e.call(t, "PUT", path, dave, "", `{"email": true, "address": "victim@example.com"}`); r.status != http.StatusBadRequest {
		t.Fatalf("an address in the body: %d %v, want 400", r.status, r.body)
	}
	if r := e.call(t, "PUT", path, dave, "", `{}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("no email field: %d %v, want 422", r.status, r.body)
	}
	if r := e.call(t, "GET", path, "did:privy:alice", "", ""); r.status != http.StatusForbidden {
		t.Fatalf("another user's profile: %d %v, want 403", r.status, r.body)
	}
}

// An account that signs in without an email (a passkey alone) has no address, and is not read again on every load.
func TestNotificationsWithoutLoginEmail(t *testing.T) {
	e := invoiceAPI(t)
	const erin = "did:privy:erin"
	for range 2 {
		if r := e.call(t, "POST", "/v1/me", erin, "", ""); r.status/100 != 2 {
			t.Fatalf("load: %d %v", r.status, r.body)
		}
	}
	e.wallets.Lock()
	reads := e.wallets.UserReads
	e.wallets.Unlock()
	if reads != 1 {
		t.Fatalf("Privy user reads %d, want 1", reads)
	}
	profile := e.call(t, "GET", "/v1/me", erin, "", "").body["profiles"].([]any)[0].(map[string]any)["profileId"].(string)
	if r := e.call(t, "GET", "/v1/profiles/"+profile+"/notifications", erin, "", ""); r.status != http.StatusOK ||
		r.body["address"] != nil {
		t.Fatalf("GET: %d %v, want a null address", r.status, r.body)
	}
}
