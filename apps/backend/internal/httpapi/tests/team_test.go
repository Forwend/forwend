package tests

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"reflect"
	"testing"
	"time"
)

// inviteToken is the link token the invite email to address carries, from its outbox row.
func (e invoiceEnv) inviteToken(t *testing.T, address string) string {
	t.Helper()
	var token string
	if err := e.pool.QueryRow(context.Background(), `SELECT coalesce(o.payload->>'token', '') FROM outbox_events o
		JOIN profile_invites i ON i.id = o.invite_id WHERE i.email = $1 ORDER BY o.id DESC LIMIT 1`, address).
		Scan(&token); err != nil {
		t.Fatal(err)
	}
	return token
}

func (e invoiceEnv) memberStores(t *testing.T, profile, user string) []string {
	t.Helper()
	var ids []string
	if err := e.pool.QueryRow(context.Background(), `SELECT coalesce(array_agg(ms.store_id::text ORDER BY ms.store_id), '{}')
		FROM member_stores ms JOIN users u ON u.id = ms.user_id WHERE ms.profile_id = $1 AND u.privy_user_id = $2`,
		profile, user).Scan(&ids); err != nil {
		t.Fatal(err)
	}
	return ids
}

// R-139, D-93, D-63.
func TestTeamInvitesAndRoles(t *testing.T) {
	e := invoiceAPI(t)
	ctx := context.Background()
	const alice, bob, carol = "did:privy:alice", "did:privy:bob", "did:privy:carol"
	shop := e.merchant(t)
	first := storeIDs(t, e, shop)[0]
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+storeB, alice, "", `{"name": "Pro shop",
		"defaultExpiresIn": 3600}`); r.status != http.StatusCreated {
		t.Fatalf("PUT store: %d %v", r.status, r.body)
	}
	e.exec(t, "UPDATE users SET login_email = 'alice@example.com' WHERE privy_user_id = $1", alice)
	e.wallets.Lock()
	e.wallets.Emails[bob], e.wallets.Emails[carol] = "Bob@Example.com", "carol@example.com"
	e.wallets.Unlock()
	if r := e.call(t, "POST", "/v1/me", carol, "", ""); r.status != http.StatusCreated {
		t.Fatalf("Carol signs up: %d %v", r.status, r.body)
	}
	path := func(suffix string) string { return "/v1/profiles/" + shop + suffix }
	invite := func(body string) reply { return e.call(t, "POST", path("/invites"), alice, "", body) }

	for body, code := range map[string]string{
		`{"email": "bob@example.com", "role": "owner"}`:                                   "invalid_value",
		`{"email": "bob@example.com", "role": "developer"}`:                               "invalid_value",
		`{"email": "bob@example.com", "role": "admin", "stores": ["` + storeB + `"]}`:     "invalid_value",
		`{"email": "bob@example.com", "role": "finance", "stores": ["` + storeA + `"]}`:   "invalid_value",
		`{"email": "Bob <bob@example.com>", "role": "admin"}`:                             "invalid_value",
		`{"email": "alice@example.com", "role": "admin"}`:                                 "already_on_team",
		`{"email": "bob@example.com", "role": "developer", "stores": ["not-a-store-id"]}`: "invalid_value",
	} {
		if r := invite(body); errorCode(r) != code {
			t.Errorf("invite %s: %d %v, want %s", body, r.status, r.body, code)
		}
	}
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invites", alice, "",
		`{"email": "bob@example.com", "role": "admin"}`); r.status != http.StatusConflict || errorCode(r) != "not_merchant" {
		t.Errorf("an invite to a freelancer profile: %d %v", r.status, r.body)
	}
	// Giving a role needs a fresh sign-in (D-63).
	if r := e.signedAt(t, "POST", path("/invites"), alice, time.Now().Add(-10*time.Minute),
		`{"email": "bob@example.com", "role": "admin"}`); errorCode(r) != "reauth_required" {
		t.Errorf("an invite with an old sign-in: %d %v", r.status, r.body)
	}

	made := invite(`{"email": " Bob@Example.com ", "role": "developer", "stores": ["` + storeB + `", "` + storeB + `"]}`)
	if made.status != http.StatusCreated || made.body["email"] != "bob@example.com" || made.body["role"] != "developer" ||
		!reflect.DeepEqual(made.body["stores"], []any{storeB}) {
		t.Fatalf("invite Bob: %d %v", made.status, made.body)
	}
	token := e.inviteToken(t, "bob@example.com")
	var hash []byte
	var expires time.Time
	if err := e.pool.QueryRow(ctx, "SELECT token_hash, expires_at FROM profile_invites WHERE id = $1",
		made.body["inviteId"]).Scan(&hash, &expires); err != nil {
		t.Fatal(err)
	}
	if sum := sha256.Sum256([]byte(token)); len(token) != 64 || !reflect.DeepEqual(hash, sum[:]) {
		t.Fatalf("the invite keeps %x for token %q, want its SHA-256", hash, token)
	}
	if d := time.Until(expires); d < 7*24*time.Hour-time.Minute || d > 7*24*time.Hour {
		t.Errorf("the invite expires in %s, want 7 days", d)
	}
	team := e.call(t, "GET", path("/members"), alice, "", "")
	members, _ := team.body["members"].([]any)
	invites, _ := team.body["invites"].([]any)
	if team.status != http.StatusOK || len(members) != 1 || members[0].(map[string]any)["role"] != "owner" ||
		members[0].(map[string]any)["email"] != "alice@example.com" || len(invites) != 1 {
		t.Fatalf("the team: %d %v", team.status, team.body)
	}

	// Anyone signed in with the link reads it; only the invited address accepts it, once.
	if r := e.call(t, "GET", "/v1/invites/"+token, carol, "", ""); r.status != http.StatusOK ||
		r.body["email"] != "bob@example.com" || r.body["role"] != "developer" || r.body["profileName"] != "Alice Shop" {
		t.Fatalf("read the invite: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", "/v1/invites/"+token+"/accept", carol, "", ""); r.status != http.StatusForbidden ||
		errorCode(r) != "invite_for_another_email" {
		t.Fatalf("Carol accepts Bob's invite: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", "/v1/invites/"+token+"/accept", bob, "", ""); r.status != http.StatusOK ||
		r.body["profileId"] != shop {
		t.Fatalf("Bob accepts: %d %v", r.status, r.body)
	}
	for _, method := range []string{"GET", "POST"} {
		suffix := map[string]string{"GET": "", "POST": "/accept"}[method]
		if r := e.call(t, method, "/v1/invites/"+token+suffix, bob, "", ""); r.status != http.StatusNotFound ||
			errorCode(r) != "invite_not_found" {
			t.Errorf("%s the used invite: %d %v", method, r.status, r.body)
		}
	}
	var bobID string
	var onboarded bool
	if err := e.pool.QueryRow(ctx, "SELECT id::text, onboarded_at IS NOT NULL FROM users WHERE privy_user_id = $1", bob).
		Scan(&bobID, &onboarded); err != nil || !onboarded {
		t.Fatalf("Bob onboarded: %v %v", onboarded, err)
	}
	if me := profilesOf(e.call(t, "GET", "/v1/me", bob, "", "")); me[len(me)-1]["profileId"] != shop ||
		me[len(me)-1]["role"] != "developer" ||
		!reflect.DeepEqual(me[len(me)-1]["permissions"], []any{"invoices.read", "invoices.write", "stores.read",
			"stores.write", "tokens.read", "team.leave"}) {
		t.Fatalf("Bob's profiles: %v", me)
	}
	if got := e.memberStores(t, shop, bob); !reflect.DeepEqual(got, []string{storeB}) {
		t.Fatalf("Bob's stores: %v", got)
	}

	// An Admin changes a role and stores with a fresh sign-in; the owner stays an Admin.
	change := `{"role": "finance", "stores": ["` + first + `"]}`
	if r := e.signedAt(t, "PUT", path("/members/"+bobID), alice, time.Now().Add(-10*time.Minute), change); errorCode(r) !=
		"reauth_required" {
		t.Errorf("a role change with an old sign-in: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path("/members/"+bobID), alice, "", change); r.status != http.StatusOK ||
		r.body["role"] != "finance" || !reflect.DeepEqual(r.body["stores"], []any{first}) {
		t.Fatalf("make Bob Finance: %d %v", r.status, r.body)
	}
	if got := e.memberStores(t, shop, bob); !reflect.DeepEqual(got, []string{first}) {
		t.Fatalf("Bob's stores after the change: %v", got)
	}
	var aliceID string
	if err := e.pool.QueryRow(ctx, "SELECT id::text FROM users WHERE privy_user_id = $1", alice).Scan(&aliceID); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"PUT", "DELETE"} {
		if r := e.call(t, method, path("/members/"+aliceID), alice, "", `{"role": "developer", "stores": ["`+first+`"]}`); r.status !=
			http.StatusUnprocessableEntity {
			t.Errorf("%s the owner: %d %v", method, r.status, r.body)
		}
		if r := e.call(t, method, path("/members/00000000-0000-4000-8000-000000000000"), alice, "",
			`{"role": "admin"}`); errorCode(r) != "member_not_found" {
			t.Errorf("%s an unknown member: %d %v", method, r.status, r.body)
		}
	}
	if r := e.call(t, "POST", path("/leave"), alice, "", ""); r.status != http.StatusUnprocessableEntity {
		t.Errorf("the owner leaves: %d %v", r.status, r.body)
	}

	// A member leaves; an Admin removes another.
	if r := e.call(t, "POST", path("/leave"), bob, "", ""); r.status != http.StatusNoContent {
		t.Fatalf("Bob leaves: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", path("/invoices"), bob, "", ""); r.status != http.StatusForbidden {
		t.Errorf("Bob after leaving: %d", r.status)
	}
	e.exec(t, `INSERT INTO profile_members (profile_id, user_id, role) SELECT $1, id, 'admin' FROM users
		WHERE privy_user_id = $2`, shop, carol)
	var carolID string
	if err := e.pool.QueryRow(ctx, "SELECT id::text FROM users WHERE privy_user_id = $1", carol).Scan(&carolID); err != nil {
		t.Fatal(err)
	}
	// An Admin's open invites end with them: a removed Admin can't come back through an address they invited.
	if r := e.call(t, "POST", path("/invites"), carol, "", `{"email": "erin@example.com", "role": "admin"}`); r.status !=
		http.StatusCreated {
		t.Fatalf("Carol invites: %d %v", r.status, r.body)
	}
	if r := e.call(t, "DELETE", path("/members/"+carolID), alice, "", ""); r.status != http.StatusOK {
		t.Fatalf("remove Carol: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", "/v1/invites/"+e.inviteToken(t, "erin@example.com"), bob, "", ""); r.status !=
		http.StatusNotFound {
		t.Errorf("the removed Admin's invite: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", path("/members"), carol, "", ""); r.status != http.StatusForbidden {
		t.Errorf("Carol after removal: %d", r.status)
	}

	// A new invite to the same address revokes the last; a revoked or expired link opens nothing.
	invite(`{"email": "dan@example.com", "role": "admin"}`)
	old := e.inviteToken(t, "dan@example.com")
	again := invite(`{"email": "dan@example.com", "role": "admin"}`)
	if r := e.call(t, "GET", "/v1/invites/"+old, carol, "", ""); r.status != http.StatusNotFound {
		t.Errorf("the replaced invite: %d %v", r.status, r.body)
	}
	if r := e.call(t, "DELETE", path("/invites/"+again.body["inviteId"].(string)), alice, "", ""); r.status !=
		http.StatusNoContent {
		t.Fatalf("revoke: %d %v", r.status, r.body)
	}
	if r := e.call(t, "DELETE", path("/invites/"+again.body["inviteId"].(string)), alice, "", ""); errorCode(r) !=
		"invite_not_found" {
		t.Errorf("revoke twice: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", "/v1/invites/"+e.inviteToken(t, "dan@example.com"), carol, "", ""); r.status !=
		http.StatusNotFound {
		t.Errorf("the revoked invite: %d %v", r.status, r.body)
	}
	invite(`{"email": "carol@example.com", "role": "admin"}`)
	e.exec(t, "UPDATE profile_invites SET expires_at = now() - interval '1 second' WHERE email = 'carol@example.com'")
	if r := e.call(t, "POST", "/v1/invites/"+e.inviteToken(t, "carol@example.com")+"/accept", carol, "", ""); errorCode(r) !=
		"invite_not_found" {
		t.Errorf("an expired invite: %d %v", r.status, r.body)
	}
}

// R-139, R-116: invites are emails to strangers, so they share the client email cap.
func TestInvitesCountTowardTheClientEmailCap(t *testing.T) {
	e := invoiceAPI(t)
	shop := e.merchant(t)
	for i := range 20 {
		if r := e.call(t, "POST", "/v1/profiles/"+shop+"/invites", "did:privy:alice", "",
			fmt.Sprintf(`{"email": "person%d@example.com", "role": "admin"}`, i)); r.status != http.StatusCreated {
			t.Fatalf("invite %d: %d %v", i, r.status, r.body)
		}
	}
	r := e.call(t, "POST", "/v1/profiles/"+shop+"/invites", "did:privy:alice", "", `{"email": "one@example.com",
		"role": "admin"}`)
	if r.status != http.StatusTooManyRequests || errorCode(r) != "rate_limited" {
		t.Fatalf("invite 21: %d %v", r.status, r.body)
	}
}

// D-93: an Admin taken off the team, or given another role, leaves what they could still use: the API keys they made
// and the webhook endpoints whose secrets they could reveal. The answer lists them for the owner to roll; a member
// who never was an Admin leaves nothing.
func TestARemovedOrDemotedAdminLeavesWhatToRoll(t *testing.T) {
	e := invoiceAPI(t)
	const alice, bob = "did:privy:alice", "did:privy:bob"
	shop := e.merchant(t)
	path := func(p string) string { return "/v1/profiles/" + shop + p }
	store := storeIDs(t, e, shop)[0]
	var bobID string
	if err := e.pool.QueryRow(t.Context(), `INSERT INTO profile_members (profile_id, user_id, role)
		SELECT $1, id, 'admin' FROM users WHERE privy_user_id = $2 RETURNING user_id::text`, shop, bob).Scan(&bobID); err != nil {
		t.Fatal(err)
	}
	made := e.call(t, "POST", path("/keys"), bob, "", `{"name": "Bob's", "storeId": "`+store+`", "scopes": ["invoices.read"]}`)
	if made.status != http.StatusCreated {
		t.Fatalf("Bob makes a key: %d %v", made.status, made.body)
	}
	if r := e.call(t, "PUT", path("/webhooks/eeeeeeee-0000-4000-8000-000000000001"), alice, "",
		`{"url": "https://shop.example.com/hooks", "events": ["invoice.paid"]}`); r.status != http.StatusCreated {
		t.Fatalf("an endpoint: %d %v", r.status, r.body)
	}
	listed := func(r reply) (keys, hooks []any) {
		roll, _ := r.body["toRoll"].(map[string]any)
		keys, _ = roll["keys"].([]any)
		hooks, _ = roll["webhooks"].([]any)
		return keys, hooks
	}
	demoted := e.call(t, "PUT", path("/members/"+bobID), alice, "", `{"role": "developer", "stores": ["`+store+`"]}`)
	if keys, hooks := listed(demoted); demoted.status != http.StatusOK || len(keys) != 1 || len(hooks) != 1 ||
		keys[0].(map[string]any)["keyId"] != made.body["keyId"] {
		t.Errorf("Bob made a Developer: %d %v", demoted.status, demoted.body)
	}
	removed := e.call(t, "DELETE", path("/members/"+bobID), alice, "", "")
	if keys, hooks := listed(removed); removed.status != http.StatusOK || len(keys) != 1 || len(hooks) != 0 {
		t.Errorf("Bob removed as a Developer, his key still working: %d %v", removed.status, removed.body)
	}
}
