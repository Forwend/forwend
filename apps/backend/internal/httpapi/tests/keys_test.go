package tests

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"
)

var keyText = regexp.MustCompile(`^fw_test_[0-9A-Za-z]{36}$`)

// withKey calls the API with a secret API key as the bearer.
func (e invoiceEnv) withKey(t *testing.T, method, path, key, body string) reply {
	t.Helper()
	req, err := http.NewRequest(method, e.srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+key)
	return e.do(t, req)
}

// R-144, D-87, D-61, D-63.
func TestAPIKeys(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	first := storeIDs(t, e, shop)[0]
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+storeB, alice, "", `{"name": "Pro shop",
		"defaultExpiresIn": 3600}`); r.status != http.StatusCreated {
		t.Fatalf("PUT store: %d %v", r.status, r.body)
	}
	keys := "/v1/profiles/" + shop + "/keys"
	made := e.call(t, "POST", keys, alice, "", `{"name": " Shop server ", "storeId": "`+first+`",
		"scopes": ["invoices.write", "invoices.read", "invoices.read"]}`)
	secret, _ := made.body["secret"].(string)
	if made.status != http.StatusCreated || !keyText.MatchString(secret) || made.body["last4"] != secret[len(secret)-4:] ||
		made.body["name"] != "Shop server" || made.body["storeId"] != first || made.body["livemode"] != false ||
		strings.Join(toStrings(made.body["scopes"]), ",") != "invoices.read,invoices.write" {
		t.Fatalf("a new key: %d %v", made.status, made.body)
	}
	id := made.body["keyId"].(string)
	// Only its SHA-256 is kept.
	var row string
	var hash []byte
	if err := e.pool.QueryRow(context.Background(), "SELECT row_to_json(k)::text, secret_hash FROM api_keys k WHERE id = $1",
		id).Scan(&row, &hash); err != nil {
		t.Fatal(err)
	}
	if sum := sha256.Sum256([]byte(secret)); strings.Contains(row, secret[8:len(secret)-4]) || string(hash) != string(sum[:]) {
		t.Fatalf("the stored key: %s", row)
	}

	for body, code := range map[string]string{
		`{"name": "A", "scopes": ["invoices.read"]}`:                                     "invalid_value", // no store
		`{"name": "A", "storeId": "` + storeA + `", "scopes": ["invoices.read"]}`:        "invalid_value", // another profile's
		`{"name": "A", "storeId": "` + first + `", "scopes": []}`:                        "invalid_value",
		`{"name": "A", "storeId": "` + first + `", "scopes": ["money.write"]}`:           "invalid_value",
		`{"name": "A", "storeId": "` + first + `", "scopes": ["invoices.read", "team"]}`: "invalid_value",
		`{"name": "", "storeId": "` + first + `", "scopes": ["invoices.read"]}`:          "invalid_value",
		`{"name": "A", "storeId": "not-a-store", "scopes": ["invoices.read"]}`:           "invalid_value",
	} {
		if r := e.call(t, "POST", keys, alice, "", body); errorCode(r) != code {
			t.Errorf("POST %s: %d %v, want %s", body, r.status, r.body, code)
		}
	}
	if r := e.call(t, "POST", "/v1/profiles/"+e.bobProfile+"/keys", "did:privy:bob", "",
		`{"name": "A", "scopes": ["invoices.read"]}`); errorCode(r) != "personal_profile" {
		t.Errorf("a personal profile's key: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/keys", alice, "",
		`{"name": "Laptop", "scopes": ["invoices.read"]}`); r.status != http.StatusCreated || r.body["storeId"] != nil {
		t.Errorf("a freelancer's key: %d %v", r.status, r.body)
	}

	// The key reaches its profile's routes that its scopes allow, for its store.
	invoices := "/v1/profiles/" + shop + "/invoices"
	other := e.call(t, "POST", invoices, alice, "other-store", `{"chainId": 84532, "token": "`+usdc+`", "amount": "1000000",
		"storeId": "`+storeB+`"}`)
	req, _ := http.NewRequest("POST", e.srv.URL+invoices, strings.NewReader(`{"chainId": 84532, "token": "`+usdc+
		`", "amount": "1000000"}`))
	req.Header.Set("Authorization", "Bearer "+secret)
	req.Header.Set("Idempotency-Key", "by-key")
	if r := e.do(t, req); r.status != http.StatusCreated || r.body["store"].(map[string]any)["storeId"] != first {
		t.Fatalf("an invoice made with the key: %d %v", r.status, r.body)
	}
	list := e.withKey(t, "GET", invoices, secret, "")
	if items, _ := list.body["items"].([]any); list.status != http.StatusOK || len(items) != 1 {
		t.Fatalf("the key's invoice list: %d %v", list.status, list.body)
	}
	for _, c := range []struct{ method, path, body, code string }{
		{"GET", invoices + "/" + other.body["invoiceId"].(string), "", "invoice_not_found"}, // another store's
		{"GET", "/v1/profiles/" + shop + "/balances", "", "forbidden"},                      // no money scope
		{"GET", keys, "", "forbidden"},                                                      // keys don't manage keys
		{"PUT", "/v1/profiles/" + shop + "/billing-details", billingBody, "forbidden"},      // no billing scope
		{"GET", "/v1/profiles/" + e.aliceProfile + "/invoices", "", "forbidden"},            // another profile
		{"GET", "/v1/me", "", "unauthorized"},
	} {
		if r := e.withKey(t, c.method, c.path, secret, c.body); errorCode(r) != c.code {
			t.Errorf("%s %s with the key: %d %v, want %s", c.method, c.path, r.status, r.body, c.code)
		}
	}
	bad := secret[:len(secret)-1] + map[bool]string{true: "B", false: "A"}[strings.HasSuffix(secret, "A")]
	for _, key := range []string{bad, "fw_test_nope", "fw_live_" + secret[8:]} {
		if r := e.withKey(t, "GET", invoices, key, ""); errorCode(r) != "invalid_api_key" {
			t.Errorf("GET with %q: %d %v", key, r.status, r.body)
		}
	}
	listed := e.call(t, "GET", keys, alice, "", "")
	if ks, _ := listed.body["keys"].([]any); len(ks) != 1 || ks[0].(map[string]any)["lastUsedAt"] == nil ||
		ks[0].(map[string]any)["secret"] != nil {
		t.Fatalf("the keys after use: %v", listed.body)
	}

	// Another profile's owner can neither roll nor revoke it.
	for _, method := range []string{"POST", "DELETE"} {
		path := "/v1/profiles/" + e.aliceProfile + "/keys/" + id
		if method == "POST" {
			path += "/roll"
		}
		if r := e.call(t, method, path, alice, "", "{}"); errorCode(r) != "key_not_found" {
			t.Errorf("%s %s through another profile: %d %v", method, path, r.status, r.body)
		}
	}

	// Rolling makes a new key; the old one works for the overlap, then stops.
	rolled := e.call(t, "POST", keys+"/"+id+"/roll", alice, "", `{"overlapHours": 1}`)
	next, _ := rolled.body["secret"].(string)
	if rolled.status != http.StatusCreated || !keyText.MatchString(next) || next == secret || rolled.body["storeId"] != first {
		t.Fatalf("roll: %d %v", rolled.status, rolled.body)
	}
	for _, key := range []string{secret, next} {
		if r := e.withKey(t, "GET", invoices, key, ""); r.status != http.StatusOK {
			t.Errorf("during the overlap: %d %v", r.status, r.body)
		}
	}
	if r := e.call(t, "POST", keys+"/"+id+"/roll", alice, "", `{}`); errorCode(r) != "key_not_found" {
		t.Errorf("rolling a rolled key: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", keys+"/"+rolled.body["keyId"].(string)+"/roll", alice, "", `{"overlapHours": 169}`); errorCode(r) !=
		"invalid_value" {
		t.Errorf("an overlap over 7 days: %d %v", r.status, r.body)
	}
	e.exec(t, "UPDATE api_keys SET expires_at = now() - interval '1 second' WHERE id = $1", id)
	if r := e.withKey(t, "GET", invoices, secret, ""); errorCode(r) != "invalid_api_key" {
		t.Errorf("after the overlap: %d %v", r.status, r.body)
	}

	// Revoking stops a key at once.
	if r := e.call(t, "DELETE", keys+"/"+rolled.body["keyId"].(string), alice, "", ""); r.status != http.StatusNoContent {
		t.Fatalf("revoke: %d %v", r.status, r.body)
	}
	if r := e.withKey(t, "GET", invoices, next, ""); errorCode(r) != "invalid_api_key" {
		t.Errorf("a revoked key: %d %v", r.status, r.body)
	}
	if r := e.call(t, "DELETE", keys+"/"+rolled.body["keyId"].(string), alice, "", ""); errorCode(r) != "key_not_found" {
		t.Errorf("revoking twice: %d %v", r.status, r.body)
	}
	if ks, _ := e.call(t, "GET", keys, alice, "", "").body["keys"].([]any); len(ks) != 0 {
		t.Errorf("working keys after the revoke: %v", ks)
	}
}

// R-144, D-93: only the owner and Admins manage keys.
func TestAPIKeysNeedTheKeysPermission(t *testing.T) {
	e := invoiceAPI(t)
	shop := e.merchant(t)
	e.exec(t, `WITH u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:dave'), ('did:privy:erin') RETURNING id,
		    privy_user_id)
		INSERT INTO profile_members (profile_id, user_id, role)
		SELECT $1, id, CASE privy_user_id WHEN 'did:privy:dave' THEN 'admin' ELSE 'developer' END FROM u`, shop)
	keys := "/v1/profiles/" + shop + "/keys"
	if r := e.call(t, "GET", keys, "did:privy:dave", "", ""); r.status != http.StatusOK {
		t.Errorf("an Admin lists keys: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", keys, "did:privy:erin", "", ""); errorCode(r) != "forbidden" {
		t.Errorf("a Developer lists keys: %d %v", r.status, r.body)
	}
}

// D-93: a request checked before its Admin was removed makes no key or webhook endpoint after the removal.
func TestRequestsCheckedBeforeARemovalGrantNothing(t *testing.T) {
	for name, c := range map[string]struct{ method, path, body string }{
		"key": {"POST", "/keys", `{"name": "Late", "storeId": "%s", "scopes": ["invoices.read"]}`},
		"webhook endpoint": {"PUT", "/webhooks/6f9619ff-8b86-4011-b42d-00c04fc964ff",
			`{"url": "https://late.example.com/hooks", "events": ["invoice.paid"], "storeId": "%s"}`},
	} {
		t.Run(name, func(t *testing.T) {
			e := invoiceAPI(t)
			ctx := context.Background()
			shop := e.merchant(t)
			body := fmt.Sprintf(c.body, storeIDs(t, e, shop)[0])
			e.exec(t, `WITH u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:dave') RETURNING id)
				INSERT INTO profile_members (profile_id, user_id, role) SELECT $1, id, 'admin' FROM u`, shop)
			// The removal, as team.RemoveMember: the profile row first, then the member.
			remove, err := e.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer remove.Rollback(ctx)
			if _, err := remove.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE", shop); err != nil {
				t.Fatal(err)
			}
			made := make(chan reply, 1)
			go func() { made <- e.call(t, c.method, "/v1/profiles/"+shop+c.path, "did:privy:dave", "", body) }()
			for waiting, start := 0, time.Now(); waiting == 0; {
				if time.Since(start) > 10*time.Second {
					t.Fatal("the request never waited for the lock")
				}
				if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'
					AND datname = current_database()`).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := remove.Exec(ctx, `DELETE FROM profile_members WHERE profile_id = $1 AND user_id =
				(SELECT id FROM users WHERE privy_user_id = 'did:privy:dave')`, shop); err != nil {
				t.Fatal(err)
			}
			if err := remove.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			if r := <-made; errorCode(r) != "forbidden" {
				t.Fatalf("a removed Admin's %s: %d %v", name, r.status, r.body)
			}
		})
	}
}

func toStrings(v any) []string {
	var out []string
	list, _ := v.([]any)
	for _, s := range list {
		out = append(out, s.(string))
	}
	return out
}
