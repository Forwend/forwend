package tests

import (
	"context"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

// signedAt calls the API with a token issued at iat.
func (e invoiceEnv) signedAt(t *testing.T, method, path, user string, iat time.Time, body string) reply {
	t.Helper()
	req, err := http.NewRequest(method, e.srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	c := claims(user)
	c["iat"], c["exp"] = iat.Unix(), iat.Add(time.Hour).Unix()
	req.Header.Set("Authorization", "Bearer "+signES256(t, e.privyKey, c))
	return e.do(t, req)
}

// R-137, D-49, D-63.
func TestBillingDetailsNeedAFreshSignIn(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	path := "/v1/profiles/" + e.aliceProfile + "/billing-details"
	put := func(iat time.Time, name string) reply {
		t.Helper()
		return e.signedAt(t, "PUT", path, alice, iat, strings.Replace(billingBody, "Alice Design GmbH", name, 1))
	}
	saved := func() string {
		t.Helper()
		var name string
		if err := e.pool.QueryRow(context.Background(), "SELECT name FROM profile_billing_details WHERE profile_id = $1",
			e.aliceProfile).Scan(&name); err != nil {
			t.Fatal(err)
		}
		return name
	}
	setPasskey := func(at int64) {
		e.wallets.Lock()
		e.wallets.PasskeySignIn = at
		e.wallets.Unlock()
	}

	if r := put(signedInAt, "Fresh GmbH"); r.status != http.StatusOK || saved() != "Fresh GmbH" {
		t.Fatalf("a token from a passkey sign-in: %d %v", r.status, r.body)
	}
	// A refresh issues a new token, but the sign-in time stays the old one.
	refreshed := signedInAt.Add(2 * time.Second)
	if r := put(refreshed, "Refreshed GmbH"); r.status != http.StatusUnauthorized || errorCode(r) != "reauth_required" ||
		saved() != "Fresh GmbH" {
		t.Fatalf("a refreshed token: %d %v, saved %q", r.status, r.body, saved())
	}
	old := time.Now().Add(-6 * time.Minute)
	setPasskey(old.Unix())
	if r := put(old, "Old GmbH"); r.status != http.StatusUnauthorized || errorCode(r) != "reauth_required" {
		t.Fatalf("a sign-in 6 minutes ago: %d %v", r.status, r.body)
	}
	// A Google sign-in can't be asked for again (S-8), so it never counts.
	setPasskey(0)
	e.wallets.Lock()
	e.wallets.GoogleSignIn = refreshed.Unix()
	e.wallets.Unlock()
	if r := put(refreshed, "Google GmbH"); r.status != http.StatusUnauthorized || errorCode(r) != "reauth_required" {
		t.Fatalf("a token from a Google sign-in: %d %v", r.status, r.body)
	}
	// The email account's sign-in time counts too.
	e.wallets.Lock()
	e.wallets.Emails[alice], e.wallets.SignedInAt[alice] = "alice@example.com", refreshed.Unix()
	e.wallets.Unlock()
	if r := put(refreshed, "Email GmbH"); r.status != http.StatusOK || saved() != "Email GmbH" {
		t.Fatalf("a token from an email sign-in: %d %v", r.status, r.body)
	}
	e.wallets.Lock()
	e.wallets.FailUserReads = 10 // more than the SDK's retries
	e.wallets.Unlock()
	if r := put(refreshed, "Unchecked GmbH"); r.status != http.StatusInternalServerError || saved() != "Email GmbH" {
		t.Fatalf("Privy can't answer: %d %v, saved %q", r.status, r.body, saved())
	}
	// Reads and other changes need no fresh sign-in.
	if r := e.signedAt(t, "GET", path, alice, old, ""); r.status != http.StatusOK {
		t.Fatalf("GET billing details with an older sign-in: %d %v", r.status, r.body)
	}
}

// R-137.
func TestSignOutEverywhere(t *testing.T) {
	e := invoiceAPI(t)
	const alice, bob = "did:privy:alice", "did:privy:bob"
	me := func(user string, iat time.Time) int {
		t.Helper()
		return e.signedAt(t, "GET", "/v1/profiles/"+e.aliceProfile+"/clients", user, iat, "").status
	}
	before := time.Now().Add(-time.Minute)
	e.wallets.Lock()
	e.wallets.FailFreezes = 10 // more than the SDK's retries
	e.wallets.Unlock()
	if r := e.signedAt(t, "POST", "/v1/me/sign-out-everywhere", alice, before, ""); r.status !=
		http.StatusInternalServerError || me(alice, before) != http.StatusOK {
		t.Fatalf("Privy fails: %d %v; the session must stay", r.status, r.body)
	}
	// A freeze that failed may still have landed, and a frozen user can't sign in: the unfreeze is always sent.
	if n := len(e.wallets.Freezes); n == 0 || e.wallets.Freezes[n-1] != "unfreeze "+alice {
		t.Fatalf("after a failed freeze, Privy calls %v, want an unfreeze last", e.wallets.Freezes)
	}
	e.wallets.Lock()
	e.wallets.FailFreezes, e.wallets.Freezes = 0, nil
	e.wallets.Unlock()
	if r := e.signedAt(t, "POST", "/v1/me/sign-out-everywhere", alice, before, ""); r.status != http.StatusNoContent {
		t.Fatalf("sign out everywhere: %d %v", r.status, r.body)
	}
	if want := []string{"freeze " + alice, "unfreeze " + alice}; !reflect.DeepEqual(e.wallets.Freezes, want) {
		t.Fatalf("Privy calls %v, want %v", e.wallets.Freezes, want)
	}
	if got := me(alice, before); got != http.StatusUnauthorized {
		t.Fatalf("a token from before: %d", got)
	}
	if got := me(alice, time.Now().Add(time.Second)); got != http.StatusOK {
		t.Fatalf("a token from a sign-in after: %d", got)
	}
	if got := e.signedAt(t, "GET", "/v1/profiles/"+e.bobProfile+"/clients", bob, before, "").status; got !=
		http.StatusOK {
		t.Fatalf("another user's older token: %d", got)
	}
	// Once the freeze worked, a failed unfreeze still ends the tokens already issued.
	e.wallets.Lock()
	e.wallets.FailUnfreezes = 10 // more than the SDK's retries
	e.wallets.Unlock()
	if r := e.signedAt(t, "POST", "/v1/me/sign-out-everywhere", bob, before, ""); r.status != http.StatusInternalServerError {
		t.Fatalf("a failed unfreeze: %d %v", r.status, r.body)
	}
	if got := e.signedAt(t, "GET", "/v1/profiles/"+e.bobProfile+"/clients", bob, before, "").status; got !=
		http.StatusUnauthorized {
		t.Fatalf("an older token after a failed unfreeze: %d", got)
	}
}
