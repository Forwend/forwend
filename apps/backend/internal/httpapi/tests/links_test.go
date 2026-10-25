package tests

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

var linkSlug = regexp.MustCompile(`^[a-z0-9]{12}$`)

// R-140, D-54, D-94.
func TestPaymentLinks(t *testing.T) {
	e := invoiceAPI(t)
	const alice, bob = "did:privy:alice", "did:privy:bob"
	shop := e.merchant(t)
	first := storeIDs(t, e, shop)[0]
	path := func(profile, id string) string { return "/v1/profiles/" + profile + "/links/" + id }
	const fixedID, openID = "aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002"

	fixed := e.call(t, "PUT", path(shop, fixedID), alice, "", `{"title": " Logo design ", "amountUsd": "50"}`)
	if fixed.status != http.StatusCreated || !linkSlug.MatchString(fixed.body["slug"].(string)) ||
		fixed.body["title"] != "Logo design" || fixed.body["amountUsd"] != "50.00" || fixed.body["storeId"] != first ||
		fixed.body["active"] != true || fixed.body["visits"] != 0.0 || fixed.body["paid"] != 0.0 ||
		fixed.body["minUsd"] != nil || fixed.body["endsAt"] != nil || fixed.body["maxPayments"] != nil {
		t.Fatalf("a fixed link: %d %v", fixed.status, fixed.body)
	}
	// The same id again replaces every field; the slug stays.
	again := e.call(t, "PUT", path(shop, fixedID), alice, "", `{"title": "Logo design", "amountUsd": "75.5",
		"endsAt": "2027-01-31T00:00:00Z", "maxPayments": 3, "active": false}`)
	if again.status != http.StatusOK || again.body["slug"] != fixed.body["slug"] || again.body["amountUsd"] != "75.50" ||
		again.body["endsAt"] != "2027-01-31T00:00:00Z" || again.body["maxPayments"] != 3.0 || again.body["active"] != false {
		t.Fatalf("the link saved again: %d %v", again.status, again.body)
	}
	open := e.call(t, "PUT", path(shop, openID), alice, "", `{"title": "Top up", "minUsd": "10", "maxUsd": "500.00",
		"storeId": "`+first+`"}`)
	if open.status != http.StatusCreated || open.body["amountUsd"] != nil || open.body["minUsd"] != "10.00" ||
		open.body["maxUsd"] != "500.00" || open.body["slug"] == fixed.body["slug"] {
		t.Fatalf("an open link: %d %v", open.status, open.body)
	}
	// Amounts are base 10 whatever their zeros: never octal.
	for sent, saved := range map[string]string{"12.08": "12.08", "19.09": "19.09", "010": "10.00", "0.08": "0.08",
		"000000000012": "12.00", "7.5": "7.50"} {
		if r := e.call(t, "PUT", path(shop, openID), alice, "", `{"title": "Top up", "maxUsd": "`+sent+`"}`); r.status !=
			http.StatusOK || r.body["maxUsd"] != saved {
			t.Errorf("maxUsd %s: %d %v, want %s", sent, r.status, r.body["maxUsd"], saved)
		}
	}
	if r := e.call(t, "PUT", path(shop, "aaaaaaaa-0000-4000-8000-000000000003"), alice, "", `{"title": "Any"}`); r.status !=
		http.StatusCreated || r.body["minUsd"] != nil || r.body["maxUsd"] != nil {
		t.Fatalf("an open link with no limits (D-94): %d %v", r.status, r.body)
	}

	const someID = "aaaaaaaa-0000-4000-8000-000000000009"
	for body, code := range map[string]string{
		`{"title": ""}`: "invalid_value",
		`{"title": "A", "amountUsd": "10", "minUsd": "5"}`: "invalid_value",
		`{"title": "A", "minUsd": "50", "maxUsd": "10"}`:   "invalid_value",
		`{"title": "A", "amountUsd": "1.234"}`:             "invalid_value",
		`{"title": "A", "amountUsd": "0"}`:                 "invalid_value",
		`{"title": "A", "amountUsd": "-5"}`:                "invalid_value",
		`{"title": "A", "maxPayments": -1}`:                "invalid_value",
		`{"title": "A", "maxPayments": 0}`:                 "invalid_value",
		`{"title": "A", "maxPayments": 1000001}`:           "invalid_value",
		`{"title": "A", "storeId": "` + storeA + `"}`:      "store_not_found",
	} {
		if r := e.call(t, "PUT", path(shop, someID), alice, "", body); errorCode(r) != code {
			t.Errorf("PUT %s: %d %v, want %s", body, r.status, r.body, code)
		}
	}
	if r := e.call(t, "PUT", path(shop, "AAAAAAAA-0000-4000-8000-000000000009"), alice, "", `{"title": "A"}`); errorCode(r) !=
		"invalid_value" {
		t.Errorf("an upper-case link id: %d %v", r.status, r.body)
	}
	// A freelancer's link has no store; a personal profile asks with requests instead (D-52).
	if r := e.call(t, "PUT", path(e.aliceProfile, someID), alice, "", `{"title": "Hourly", "amountUsd": "80"}`); r.status !=
		http.StatusCreated || r.body["storeId"] != nil {
		t.Fatalf("a freelancer's link: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path(e.aliceProfile, "aaaaaaaa-0000-4000-8000-000000000008"), alice, "",
		`{"title": "A", "storeId": "`+first+`"}`); errorCode(r) != "invalid_value" {
		t.Errorf("a freelancer's link with a store: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path(e.bobProfile, someID), bob, "", `{"title": "A"}`); r.status != http.StatusConflict ||
		errorCode(r) != "personal_profile" {
		t.Errorf("a personal profile's link: %d %v", r.status, r.body)
	}
	// Another profile's link id is not found, and nothing changes.
	if r := e.call(t, "PUT", path(e.aliceProfile, fixedID), alice, "", `{"title": "Taken"}`); errorCode(r) !=
		"link_not_found" {
		t.Errorf("the shop's link id on another profile: %d %v", r.status, r.body)
	}

	list := e.call(t, "GET", "/v1/profiles/"+shop+"/links", alice, "", "")
	links, _ := list.body["links"].([]any)
	if list.status != http.StatusOK || len(links) != 3 ||
		links[2].(map[string]any)["linkId"] != fixedID || links[2].(map[string]any)["title"] != "Logo design" {
		t.Fatalf("the shop's links, newest first: %d %v", list.status, list.body)
	}
	if r := e.call(t, "GET", path(shop, openID), alice, "", ""); r.status != http.StatusOK || r.body["linkId"] != openID {
		t.Fatalf("GET a link: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", path(shop, someID), alice, "", ""); errorCode(r) != "link_not_found" {
		t.Errorf("GET another profile's link: %d %v", r.status, r.body)
	}

	// The paid count is the link's paid and settled invoices.
	for i, status := range []string{"paid", "open", "paid"} {
		made := e.post(t, alice, shop, "link-"+status+string(rune('a'+i)), `{"chainId": 84532, "token": "`+usdc+`",
			"amount": "1"}`)
		e.exec(t, `ALTER TABLE invoices DISABLE TRIGGER invoices_guard`)
		e.exec(t, `UPDATE invoices SET link_id = $2, payment_status = $3 WHERE id = $1`, made.body["invoiceId"], fixedID,
			status)
		e.exec(t, `ALTER TABLE invoices ENABLE TRIGGER invoices_guard`)
	}
	if r := e.call(t, "GET", path(shop, fixedID), alice, "", ""); r.body["paid"] != 2.0 {
		t.Errorf("the paid count: %v", r.body["paid"])
	}
	// Another profile's invoice can't name the link, so it never counts.
	other := e.post(t, alice, e.aliceProfile, "link-other", `{"chainId": 84532, "token": "`+usdc+`", "amount": "1"}`)
	e.exec(t, `ALTER TABLE invoices DISABLE TRIGGER invoices_guard`)
	_, err := e.pool.Exec(context.Background(), `UPDATE invoices SET link_id = $2 WHERE id = $1`,
		other.body["invoiceId"], fixedID)
	e.exec(t, `ALTER TABLE invoices ENABLE TRIGGER invoices_guard`)
	if err == nil || !strings.Contains(err.Error(), "invoices_link_fkey") {
		t.Errorf("another profile's invoice names the link: %v", err)
	}
}

// R-138: a Developer or Finance member reaches only their stores' links.
func TestPaymentLinksOfAMembersStores(t *testing.T) {
	e := invoiceAPI(t)
	const alice, dev = "did:privy:alice", "did:privy:erin"
	shop := e.merchant(t)
	first := storeIDs(t, e, shop)[0]
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+storeB, alice, "", `{"name": "Pro shop",
		"defaultExpiresIn": 3600}`); r.status != http.StatusCreated {
		t.Fatalf("PUT store: %d %v", r.status, r.body)
	}
	e.exec(t, `WITH u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:erin') RETURNING id),
		     m AS (INSERT INTO profile_members (profile_id, user_id, role) SELECT $1, id, 'developer' FROM u RETURNING user_id)
		INSERT INTO member_stores (profile_id, user_id, store_id) SELECT $1, user_id, $2 FROM m`, shop, storeB)
	path := func(id string) string { return "/v1/profiles/" + shop + "/links/" + id }
	const theirs, other = "bbbbbbbb-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002"
	if r := e.call(t, "PUT", path(other), alice, "", `{"title": "Main", "storeId": "`+first+`"}`); r.status !=
		http.StatusCreated {
		t.Fatalf("the owner's link: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path(theirs), dev, "", `{"title": "Pro"}`); r.status != http.StatusCreated ||
		r.body["storeId"] != storeB {
		t.Fatalf("a Developer's link takes their store: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path("bbbbbbbb-0000-4000-8000-000000000003"), dev, "",
		`{"title": "Main", "storeId": "`+first+`"}`); errorCode(r) != "invalid_value" {
		t.Errorf("a Developer's link for another store: %d %v", r.status, r.body)
	}
	for _, method := range []string{"GET", "PUT"} {
		if r := e.call(t, method, path(other), dev, "", `{"title": "Mine now"}`); errorCode(r) != "link_not_found" {
			t.Errorf("%s another store's link: %d %v", method, r.status, r.body)
		}
	}
	links, _ := e.call(t, "GET", "/v1/profiles/"+shop+"/links", dev, "", "").body["links"].([]any)
	if len(links) != 1 || links[0].(map[string]any)["linkId"] != theirs {
		t.Errorf("a Developer's links: %v", links)
	}
}
