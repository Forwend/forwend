package tests

import (
	"context"
	"io"
	"net/http"
	"net/http/httptrace"
	"reflect"
	"strings"
	"testing"
	"time"
)

// R-138, D-93.
func TestMembersReachOnlyWhatTheirRoleAllows(t *testing.T) {
	e := invoiceAPI(t)
	ctx := context.Background()
	const alice = "did:privy:alice"
	const admin, dev, fin, idle, stranger = "did:privy:dave", "did:privy:erin", "did:privy:fran", "did:privy:gil",
		"did:privy:mallory"
	shop := e.merchant(t)
	first := storeIDs(t, e, shop)[0]
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+storeB, alice, "", `{"name": "Pro shop",
		"defaultExpiresIn": 3600}`); r.status != http.StatusCreated {
		t.Fatalf("PUT store: %d %v", r.status, r.body)
	}
	if _, err := e.pool.Exec(ctx, `
		WITH u AS (INSERT INTO users (privy_user_id)
		           VALUES ('did:privy:dave'), ('did:privy:erin'), ('did:privy:fran'), ('did:privy:gil'), ('did:privy:mallory')
		           RETURNING id, privy_user_id),
		     m AS (INSERT INTO profile_members (profile_id, user_id, role)
		           SELECT $1, id, CASE privy_user_id WHEN 'did:privy:dave' THEN 'admin' WHEN 'did:privy:fran' THEN 'finance'
		                               ELSE 'developer' END
		           FROM u WHERE privy_user_id <> 'did:privy:mallory' RETURNING user_id)
		INSERT INTO member_stores (profile_id, user_id, store_id)
		SELECT $1, id, $2 FROM u WHERE privy_user_id IN ('did:privy:erin', 'did:privy:fran')`, shop, storeB); err != nil {
		t.Fatal(err)
	}
	fixed := `"chainId": 84532, "token": "` + usdc + `", "amount": "1"`
	// Both are overdue, for Owed, and have a paid event, for the bell.
	inFirst := e.post(t, alice, shop, "key-1", `{`+fixed+`, "dueDate": "2026-01-05"}`)
	inPro := e.post(t, alice, shop, "key-2", `{`+fixed+`, "dueDate": "2026-01-05", "storeId": "`+storeB+`"}`)
	if inFirst.status != http.StatusCreated || inPro.status != http.StatusCreated {
		t.Fatalf("invoices: %d %v %d %v", inFirst.status, inFirst.body, inPro.status, inPro.body)
	}
	for _, inv := range []reply{inFirst, inPro} {
		if _, err := e.pool.Exec(ctx, `INSERT INTO outbox_events (kind, invoice_id, payload)
			VALUES ('invoice.paid', $1, jsonb_build_object('option', $1::text))`, inv.body["invoiceId"]); err != nil {
			t.Fatal(err)
		}
	}
	// And each store holds money paid to a canceled invoice.
	var held []string
	for i, store := range []string{first, storeB} {
		r := e.post(t, alice, shop, "held-"+store, `{`+fixed+`, "storeId": "`+store+`"}`)
		id, _ := r.body["invoiceId"].(string)
		if c := e.call(t, "POST", "/v1/profiles/"+shop+"/invoices/"+id+"/cancel", alice, "", ""); c.status != http.StatusOK {
			t.Fatalf("held invoice %d: %d %v", i, c.status, c.body)
		}
		e.deposit(t, id, "1000000")
		held = append(held, id)
	}
	path := func(suffix string) string { return "/v1/profiles/" + shop + suffix }
	invoiceIDs := func(r reply) []string {
		var ids []string
		items, _ := r.body["items"].([]any)
		for _, item := range items {
			ids = append(ids, item.(map[string]any)["invoiceId"].(string))
		}
		return ids
	}
	storeList := func(user string) []string {
		var ids []string
		list, _ := e.call(t, "GET", path("/stores"), user, "", "").body["stores"].([]any)
		for _, s := range list {
			ids = append(ids, s.(map[string]any)["storeId"].(string))
		}
		return ids
	}

	me := profilesOf(e.call(t, "GET", "/v1/me", dev, "", ""))
	if len(me) != 1 || me[0]["profileId"] != shop || me[0]["role"] != "developer" {
		t.Fatalf("a member's profiles: %v", me)
	}
	if mine := profilesOf(e.call(t, "GET", "/v1/me", alice, "", "")); mine[len(mine)-1]["role"] != "owner" {
		t.Fatalf("the owner's profiles: %v", mine)
	}
	// A route a role has, and one it lacks: 200 against 403. The owner has them all.
	for _, c := range []struct {
		method, suffix, body string
		allowed              []string
	}{
		{"GET", "/clients", "", []string{alice, admin, fin}},
		{"GET", "/balances", "", []string{alice, admin, fin}},
		{"GET", "/billing-details", "", []string{alice, admin, fin}},
		{"GET", "/tokens", "", []string{alice, admin, dev, fin, idle}},
		{"PUT", "/tokens", `{"off": []}`, []string{alice, admin}},
		{"GET", "/jobs", "", []string{alice, admin}},
		{"GET", "/notifications", "", []string{alice}},
		{"GET", "/stores", "", []string{alice, admin, dev, fin, idle}},
		{"GET", "/members", "", []string{alice, admin}},
	} {
		for _, user := range []string{alice, admin, dev, fin, idle, stranger} {
			want := http.StatusForbidden
			if strings.Contains(strings.Join(c.allowed, " "), user) {
				want = http.StatusOK
			}
			if r := e.call(t, c.method, path(c.suffix), user, "", c.body); r.status != want {
				t.Errorf("%s %s as %s: %d, want %d", c.method, c.suffix, user, r.status, want)
			}
		}
	}

	// Developer and Finance members reach only their stores.
	for _, user := range []string{dev, fin} {
		if got := storeList(user); !reflect.DeepEqual(got, []string{storeB}) {
			t.Errorf("%s's stores: %v", user, got)
		}
		if got := invoiceIDs(e.call(t, "GET", path("/invoices"), user, "", "")); !reflect.DeepEqual(got,
			[]string{held[1], inPro.body["invoiceId"].(string)}) {
			t.Errorf("%s's invoices: %v", user, got)
		}
		if r := e.call(t, "GET", path("/invoices/"+inFirst.body["invoiceId"].(string)), user, "", ""); r.status !=
			http.StatusNotFound || errorCode(r) != "invoice_not_found" {
			t.Errorf("%s reads another store's invoice: %d %v", user, r.status, r.body)
		}
		if r := e.call(t, "POST", path("/invoices/"+inFirst.body["invoiceId"].(string)+"/cancel"), user, "", ""); r.status !=
			http.StatusNotFound {
			t.Errorf("%s cancels another store's invoice: %d %v", user, r.status, r.body)
		}
		if r := e.call(t, "GET", path("/invoices/"+inPro.body["invoiceId"].(string)), user, "", ""); r.status != http.StatusOK {
			t.Errorf("%s reads their store's invoice: %d %v", user, r.status, r.body)
		}
		for _, list := range []string{"/owed", "/events"} {
			r := e.call(t, "GET", path(list), user, "", "")
			items, _ := r.body["items"].([]any)
			var ids []string
			for _, item := range items {
				ids = append(ids, item.(map[string]any)["invoiceId"].(string))
			}
			want := []string{held[1], inPro.body["invoiceId"].(string)} // newest first
			if list == "/owed" {
				want = want[1:] // held money is the payer's, never owed (D-114)
			}
			if r.status != http.StatusOK || !reflect.DeepEqual(ids, want) {
				t.Errorf("%s's %s: %d %v, want %v", user, list, r.status, ids, want)
			}
		}
	}
	for list, want := range map[string]int{"/owed": 2, "/events": 4} {
		if items, _ := e.call(t, "GET", path(list), admin, "", "").body["items"].([]any); len(items) != want {
			t.Errorf("an Admin's %s: %v", list, items)
		}
	}
	if got := storeList(admin); len(got) != 2 {
		t.Errorf("an Admin's stores: %v", got)
	}
	if got := invoiceIDs(e.call(t, "GET", path("/invoices"), admin, "", "")); len(got) != 4 {
		t.Errorf("an Admin's invoices: %v", got)
	}
	if got := invoiceIDs(e.call(t, "GET", path("/invoices"), idle, "", "")); len(got) != 0 {
		t.Errorf("a Developer with no store sees invoices: %v", got)
	}

	// A Developer edits their store and no other, and can't make one; Finance changes no store.
	body := `{"name": "Pro shop 2", "defaultExpiresIn": 3600}`
	if r := e.call(t, "PUT", path("/stores/"+storeB), dev, "", body); r.status != http.StatusOK {
		t.Errorf("a Developer saves their store: %d %v", r.status, r.body)
	}
	for _, id := range []string{first, storeA} {
		if r := e.call(t, "PUT", path("/stores/"+id), dev, "", body); r.status != http.StatusNotFound ||
			errorCode(r) != "store_not_found" {
			t.Errorf("a Developer saves store %s: %d %v", id, r.status, r.body)
		}
	}
	if r := e.call(t, "PUT", path("/stores/"+storeB), fin, "", body); r.status != http.StatusForbidden {
		t.Errorf("Finance saves a store: %d %v", r.status, r.body)
	}
	// Only an Admin turns a store's tokens on or off (D-93).
	e.enableArbUSDC(t)
	off := `{"name": "Pro shop 2", "defaultExpiresIn": 3600, "tokensOff": [{"chainId": 421614, "token": "` + arbUSDC + `"}]}`
	if r := e.call(t, "PUT", path("/stores/"+storeB), dev, "", off); r.status != http.StatusForbidden {
		t.Errorf("a Developer turns a store's token off: %d %v", r.status, r.body)
	}
	if list, _ := e.call(t, "GET", path("/stores"), dev, "", "").body["stores"].([]any); len(list) != 1 ||
		len(list[0].(map[string]any)["tokensOff"].([]any)) != 0 {
		t.Errorf("the store after the refused change: %v", list)
	}
	if r := e.call(t, "PUT", path("/stores/"+storeB), admin, "", off); r.status != http.StatusOK {
		t.Errorf("an Admin turns a store's token off: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path("/stores/"+storeB), dev, "", off); r.status != http.StatusOK {
		t.Errorf("a Developer saves a store, its tokens as they are: %d %v", r.status, r.body)
	}

	// Create takes their first store, and refuses another; with no store a member can't invoice.
	made := e.post(t, dev, shop, "dev-1", `{`+fixed+`}`)
	if made.status != http.StatusCreated || made.body["store"].(map[string]any)["storeId"] != storeB {
		t.Errorf("a Developer's invoice: %d %v", made.status, made.body)
	}
	// A Revise can't reach another store's invoice either.
	if r := e.post(t, dev, shop, "dev-2", `{`+fixed+`, "replaces": "`+inFirst.body["invoiceId"].(string)+`"}`); r.status !=
		http.StatusNotFound || errorCode(r) != "invoice_not_found" {
		t.Errorf("a Developer revises another store's invoice: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", path("/invoices/"+inFirst.body["invoiceId"].(string)), alice, "", ""); r.body["paymentStatus"] !=
		"open" {
		t.Errorf("the other store's invoice after the refused Revise: %v", r.body["paymentStatus"])
	}
	for user, store := range map[string]string{dev: first, idle: ""} {
		body := `{` + fixed + `}`
		if store != "" {
			body = `{` + fixed + `, "storeId": "` + store + `"}`
		}
		if r := e.post(t, user, shop, "key-"+user, body); r.status != http.StatusUnprocessableEntity {
			t.Errorf("%s invoices for store %q: %d %v", user, store, r.status, r.body)
		}
	}

	// The database keeps members to merchant profiles, never the owner.
	for _, profile := range []string{e.aliceProfile, shop} {
		if _, err := e.pool.Exec(ctx, `INSERT INTO profile_members (profile_id, user_id, role)
			SELECT $1, id, 'admin' FROM users WHERE privy_user_id = $2`, profile, map[string]string{
			e.aliceProfile: "did:privy:mallory", shop: alice}[profile]); err == nil {
			t.Errorf("a member row on %s was taken", profile)
		}
	}
}

// R-138, D-61: a member's sign-up repairs only their own profiles' wallets, never makes one for a team's profile.
func TestMemberSignUpMakesNoWalletForTheirTeamsProfile(t *testing.T) {
	e := invoiceAPI(t)
	ctx := context.Background()
	const dave = "did:privy:dave"
	if r := e.call(t, "POST", "/v1/me", dave, "", ""); r.status != http.StatusCreated {
		t.Fatalf("Dave signs up: %d %v", r.status, r.body)
	}
	if _, err := e.pool.Exec(ctx, `INSERT INTO profile_members (profile_id, user_id, role)
		SELECT $1, id, 'admin' FROM users WHERE privy_user_id = $2`, e.walletless, dave); err != nil {
		t.Fatal(err)
	}
	if r := e.call(t, "POST", "/v1/me", dave, "", ""); r.status != http.StatusOK {
		t.Fatalf("Dave signs in again: %d %v", r.status, r.body)
	}
	var wallets int
	if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM profile_wallets WHERE profile_id = $1", e.walletless).
		Scan(&wallets); err != nil || wallets != 0 {
		t.Fatalf("the team's profile has %d wallets (%v), want none made by a member", wallets, err)
	}
	for _, c := range e.wallets.Creates {
		if c["external_id"] == e.walletless {
			t.Fatalf("Privy was asked for the team profile's wallet: %v", c)
		}
	}
}

func TestDeveloperStoreEditPreservesUnavailableTokenRestrictions(t *testing.T) {
	for _, table := range []string{"chains", "tokens"} {
		t.Run(table, func(t *testing.T) {
			e := invoiceAPI(t)
			e.enableArbUSDC(t)
			const owner, developer = "did:privy:alice", "did:privy:developer"
			shop := e.merchant(t)
			store := storeIDs(t, e, shop)[0]
			path := "/v1/profiles/" + shop + "/stores/" + store
			if r := e.call(t, "PUT", path, owner, "", `{"name":"Shop","defaultExpiresIn":3600,
				"tokensOff":[{"chainId":421614,"token":"`+arbUSDC+`"}]}`); r.status != http.StatusOK {
				t.Fatalf("disable store token: %d %v", r.status, r.body)
			}
			e.exec(t, `WITH u AS (INSERT INTO users (privy_user_id) VALUES ($1) RETURNING id),
				m AS (INSERT INTO profile_members (profile_id,user_id,role) SELECT $2,id,'developer' FROM u)
				INSERT INTO member_stores (profile_id,user_id,store_id) SELECT $2,id,$3 FROM u`, developer, shop, store)
			body := `{"name":"Renamed shop","defaultExpiresIn":3600,"tokensOff":[]}`
			if r := e.call(t, "PUT", path, developer, "", body); r.status != http.StatusForbidden {
				t.Fatalf("developer changes token restrictions: %d %v", r.status, r.body)
			}
			e.exec(t, "UPDATE "+table+" SET enabled=false WHERE chain_id=421614")
			for _, user := range []string{developer, owner} {
				if r := e.call(t, "PUT", path, user, "", body); r.status != http.StatusOK {
					t.Fatalf("%s renames store: %d %v", user, r.status, r.body)
				}
			}
			e.exec(t, "UPDATE "+table+" SET enabled=true WHERE chain_id=421614")
			invoiceBody := `{"chainId":421614,"token":"` + arbUSDC + `","amount":"1000000","storeId":"` + store + `"}`
			if r := e.post(t, developer, shop, "still-off", invoiceBody); r.status != http.StatusUnprocessableEntity {
				t.Fatalf("developer edit lost token restriction: %d %v", r.status, r.body)
			}
			if r := e.call(t, "PUT", path, owner, "", body); r.status != http.StatusOK {
				t.Fatalf("owner enables token: %d %v", r.status, r.body)
			}
			if r := e.post(t, developer, shop, "now-on", invoiceBody); r.status != http.StatusCreated {
				t.Fatalf("invoice after owner enables token: %d %v", r.status, r.body)
			}
		})
	}
}

func TestPendingRoleChangeCannotUndoDemotion(t *testing.T) {
	e := invoiceAPI(t)
	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	const actor = "did:privy:pending-admin"
	var uid string
	if err := e.pool.QueryRow(t.Context(), `WITH u AS (INSERT INTO users(privy_user_id) VALUES($1) RETURNING id),
 m AS (INSERT INTO profile_members(profile_id,user_id,role) SELECT $2,id,'admin' FROM u)
 SELECT id::text FROM u`, actor, shop).Scan(&uid); err != nil {
		t.Fatal(err)
	}
	path := "/v1/profiles/" + shop + "/members/" + uid
	body, send := io.Pipe()
	defer body.Close()
	defer send.Close()
	reading := make(chan struct{}, 1)
	trace := &httptrace.ClientTrace{Got100Continue: func() { reading <- struct{}{} }}
	ctx, cancel := context.WithTimeout(httptrace.WithClientTrace(t.Context(), trace), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "PUT", e.srv.URL+path, body)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+signES256(t, e.privyKey, claims(actor)))
	req.Header.Set("Expect", "100-continue")
	type answer struct {
		response *http.Response
		err      error
	}
	done := make(chan answer, 1)
	go func() { response, err := http.DefaultClient.Do(req); done <- answer{response, err} }()
	select {
	case <-reading:
	case result := <-done:
		if result.response != nil {
			result.response.Body.Close()
		}
		t.Fatalf("request did not reach body read: %v", result.err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	demote := e.call(t, "PUT", path, "did:privy:alice", "", `{"role":"developer","stores":["`+store+`"]}`)
	if demote.status != http.StatusOK {
		t.Fatalf("demote: %d %v", demote.status, demote.body)
	}
	if got := e.call(t, "GET", "/v1/profiles/"+shop+"/members", actor, "", ""); got.status != http.StatusForbidden {
		t.Fatalf("demoted member can read team: %d", got.status)
	}
	if _, err := io.WriteString(send, `{"role":"admin","stores":[]}`); err != nil {
		t.Fatal(err)
	}
	send.Close()
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatal(result.err)
		}
		defer result.response.Body.Close()
		if result.response.StatusCode != http.StatusForbidden {
			t.Fatalf("pending role change: %d, want 403", result.response.StatusCode)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	var role string
	if err := e.pool.QueryRow(t.Context(), "SELECT role FROM profile_members WHERE profile_id=$1 AND user_id=$2", shop, uid).Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != "developer" {
		t.Fatalf("role changed after demotion: %s", role)
	}
}
