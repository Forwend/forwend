package tests

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/link"
)

// R-142, D-54: a payer pays through a payment link. Each link takes at most 5 Pay calls here, its rate limit's burst.
func TestLinkCheckout(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	const eurc = "0x3333333333333333333333333333333333333333"
	shop := e.merchant(t)
	// The links are the second store's, so nothing falls back to the profile's first store.
	const store = storeB
	e.exec(t, `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES (84532, 'evm', $1, 'EURC', 2, true)`, eurc)
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+store, alice, "", `{"name": "Pro shop",
		"defaultExpiresIn": 7200, "brandColor": "#1F6A8C", "tokensOff": [{"chainId": 84532, "token": "`+eurc+`"}]}`); r.status !=
		http.StatusCreated {
		t.Fatalf("PUT store: %d %v", r.status, r.body)
	}
	save := func(id, body string) string {
		t.Helper()
		r := e.call(t, "PUT", "/v1/profiles/"+shop+"/links/"+id, alice, "", body)
		if r.status != http.StatusCreated && r.status != http.StatusOK {
			t.Fatalf("PUT link %s: %d %v", body, r.status, r.body)
		}
		return r.body["slug"].(string)
	}
	const fixedID, openID = "dddddddd-0000-4000-8000-000000000001", "dddddddd-0000-4000-8000-000000000002"
	fixed := save(fixedID, `{"title": "Logo design", "amountUsd": "2", "storeId": "`+store+`"}`)
	open := save(openID, `{"title": "Top up", "minUsd": "1", "maxUsd": "500", "storeId": "`+store+`"}`)
	invoices := func() int {
		t.Helper()
		var n int
		if err := e.pool.QueryRow(context.Background(), "SELECT count(*) FROM invoices WHERE profile_id = $1", shop).
			Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	pay := func(slug, key, body string) reply {
		t.Helper()
		return e.call(t, "POST", "/v1/links/"+slug+"/pay", "", key, body)
	}

	// The page reads the link and counts a visit; it makes nothing (D-54).
	r := e.call(t, "GET", "/v1/links/"+fixed, "", "", "")
	brand, _ := r.body["brand"].(map[string]any)
	if r.status != http.StatusOK || len(r.body) != 10 || r.body["livemode"] != false ||
		r.body["title"] != "Logo design" || r.body["payee"] != "Alice Shop Ltd" ||
		r.body["amountUsd"] != "2.00" || r.body["minUsd"] != nil || r.body["state"] != "on" || brand["storeId"] != store ||
		brand["color"] != "#1f6a8c" || brand["logoAt"] != nil {
		t.Fatalf("the fixed link's page: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", "/v1/links/"+open, "", "", ""); r.body["amountUsd"] != nil || r.body["minUsd"] != "1.00" ||
		r.body["maxUsd"] != "500.00" {
		t.Fatalf("the open link's page: %d %v", r.status, r.body)
	}
	for _, slug := range []string{"zzzzzzzzzzzz", "Bad"} {
		if r := e.call(t, "GET", "/v1/links/"+slug, "", "", ""); errorCode(r) != "link_not_found" {
			t.Errorf("GET /v1/links/%s: %d %v", slug, r.status, r.body)
		}
	}
	for range 2 {
		if r := e.call(t, "POST", "/v1/links/"+fixed+"/visits", "", "", ""); r.status != http.StatusNoContent {
			t.Fatalf("a visit: %d %v", r.status, r.body)
		}
	}
	if r := e.call(t, "GET", "/v1/profiles/"+shop+"/links/"+fixedID, alice, "", ""); r.body["visits"] != 2.0 ||
		invoices() != 0 {
		t.Fatalf("after two visits: %v, %d invoices", r.body["visits"], invoices())
	}

	// Pay makes a payer-chooses invoice with the link's title and store, its tokens and its default close.
	made := pay(fixed, "k-1", `{}`)
	token, _ := made.body["payToken"].(string)
	if made.status != http.StatusCreated || len(token) != 64 {
		t.Fatalf("Pay: %d %v", made.status, made.body)
	}
	if again := pay(fixed, "k-1", `{}`); again.status != http.StatusOK || again.body["payToken"] != token {
		t.Fatalf("Pay again with the same key: %d %v", again.status, again.body)
	}
	inv := e.call(t, "GET", "/v1/invoices/"+token, "", "", "")
	created, _ := time.Parse(time.RFC3339, inv.body["createdAt"].(string))
	expires, _ := time.Parse(time.RFC3339, inv.body["expiresAt"].(string))
	if inv.status != http.StatusOK || inv.body["number"] != nil || inv.body["title"] != "Logo design" ||
		inv.body["optionCount"] != 1.0 || inv.body["token"] != usdc || inv.body["amount"] != "2000000" ||
		expires.Sub(created) != 2*time.Hour {
		t.Fatalf("the link's invoice: %d %v", inv.status, inv.body)
	}
	var linkID, storeID, actor string
	if err := e.pool.QueryRow(context.Background(), `SELECT i.link_id::text, i.store_id::text, h.actor FROM invoices i
		JOIN history_events h ON h.invoice_id = i.id AND h.kind = 'invoice.created' WHERE i.pay_token = $1`, token).
		Scan(&linkID, &storeID, &actor); err != nil || linkID != fixedID || storeID != store || actor != "payer" {
		t.Fatalf("the invoice's link %s, store %s, made by %s: %v", linkID, storeID, actor, err)
	}
	if r := pay(fixed, "k-2", `{"amountUsd": "5"}`); errorCode(r) != "invalid_value" {
		t.Errorf("an amount on a fixed link: %d %v", r.status, r.body)
	}

	// An open link takes the payer's amount within its limits.
	for _, amount := range []string{"", "0.5", "501", "abc"} {
		if r := pay(open, "o-"+amount, `{"amountUsd": "`+amount+`"}`); errorCode(r) != "invalid_value" {
			t.Errorf("amountUsd %q: %d %v", amount, r.status, r.body)
		}
	}
	if r := pay(open, "o-25", `{"amountUsd": "25"}`); r.status != http.StatusCreated ||
		e.call(t, "GET", "/v1/invoices/"+r.body["payToken"].(string), "", "", "").body["amount"] != "25000000" {
		t.Fatalf("Pay 25 USD: %d %v", r.status, r.body)
	}

	// A payer's Idempotency-Key never replays the owner's invoice with the same key.
	owners := e.post(t, alice, shop, "shared-key", `{"chainId": 84532, "token": "`+usdc+`", "amount": "1000000"}`)
	donations := save("dddddddd-0000-4000-8000-000000000003", `{"title": "Donations", "storeId": "`+store+`"}`)
	if r := pay(donations, "shared-key", `{"amountUsd": "3"}`); r.status != http.StatusCreated ||
		r.body["payToken"] == owners.body["payToken"] {
		t.Fatalf("Pay with the owner's key: %d %v, owner's %v", r.status, r.body, owners.body["payToken"])
	}

	// An ended, full or off link says why and makes nothing.
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format(time.DateOnly) + "T23:59:59Z"
	save("dddddddd-0000-4000-8000-000000000003", `{"title": "Donations", "storeId": "`+store+`", "endsAt": "`+yesterday+`"}`)
	oneOff := save("dddddddd-0000-4000-8000-000000000004", `{"title": "One-off", "amountUsd": "2", "storeId": "`+store+`",
		"maxPayments": 1}`)
	first := pay(oneOff, "f-1", `{}`)
	var firstID string
	if err := e.pool.QueryRow(context.Background(), "SELECT id FROM invoices WHERE pay_token = $1",
		first.body["payToken"]).Scan(&firstID); err != nil {
		t.Fatal(err)
	}
	e.deposit(t, firstID, "2000000")
	save(fixedID, `{"title": "Logo design", "amountUsd": "2", "storeId": "`+store+`", "active": false}`)
	before := invoices()
	for slug, state := range map[string]string{donations: "ended", oneOff: "full", fixed: "off"} {
		if r := e.call(t, "GET", "/v1/links/"+slug, "", "", ""); r.body["state"] != state {
			t.Errorf("%s: state %v", state, r.body["state"])
		}
		if r := pay(slug, "closed-"+state, `{"amountUsd": "3"}`); r.status != http.StatusConflict ||
			errorCode(r) != "link_"+state {
			t.Errorf("Pay on a link that is %s: %d %v", state, r.status, r.body)
		}
	}
	if invoices() != before {
		t.Errorf("a closed link made an invoice: %d, want %d", invoices(), before)
	}
}

// R-142: Pay is limited per link and for all links together.
func TestLinkPayIsRateLimited(t *testing.T) {
	e := invoiceAPI(t)
	r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/links/eeeeeeee-0000-4000-8000-000000000001",
		"did:privy:alice", "", `{"title": "Hourly", "amountUsd": "1"}`)
	slug := r.body["slug"].(string)
	for i := range 5 {
		if r := e.call(t, "POST", "/v1/links/"+slug+"/pay", "", "k-"+strconv.Itoa(i), `{}`); r.status != http.StatusCreated {
			t.Fatalf("Pay %d: %d %v", i, r.status, r.body)
		}
	}
	if r := e.call(t, "POST", "/v1/links/"+slug+"/pay", "", "k-5", `{}`); errorCode(r) != "rate_limited" {
		t.Fatalf("a sixth Pay on one link: %d %v", r.status, r.body)
	}
	// The budget for everyone is asked only by a Pay that would make an invoice (R-117), and a refusal makes none.
	links := link.NewService(e.pool, invoice.NewService(e.pool))
	asked := 0
	refuse := func() time.Duration { asked++; return time.Second }
	off := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/links/eeeeeeee-0000-4000-8000-000000000002",
		"did:privy:alice", "", `{"title": "Old", "amountUsd": "1", "active": false}`).body["slug"].(string)
	for _, c := range []struct{ slug, amount string }{{"zzzzzzzzzzzz", ""}, {"Bad", ""}, {off, ""}, {slug, "5"}} {
		if _, _, err := links.Pay(t.Context(), c.slug, "k-x", link.PayRequest{AmountUSD: c.amount, Allow: refuse}); err == nil {
			t.Errorf("Pay %s %q: no error", c.slug, c.amount)
		}
	}
	if _, _, err := links.Pay(t.Context(), slug, strings.Repeat("k", link.MaxPayKey+1), link.PayRequest{Allow: refuse}); !errors.Is(err,
		link.ErrInvalid) {
		t.Errorf("a key over %d bytes: %v", link.MaxPayKey, err)
	}
	// A repeated key gets its invoice back from create's replay, before the budget is asked.
	if _, created, err := links.Pay(t.Context(), slug, "k-0", link.PayRequest{Allow: refuse}); err != nil || created {
		t.Errorf("Pay with a used key: created %v, %v", created, err)
	}
	var before, after int
	count := func(n *int) {
		t.Helper()
		if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM invoices WHERE profile_id = $1", e.aliceProfile).
			Scan(n); err != nil {
			t.Fatal(err)
		}
	}
	count(&before)
	_, _, err := links.Pay(t.Context(), slug, "k-6", link.PayRequest{Allow: refuse})
	count(&after)
	var soon *invoice.TooSoonError
	if !errors.As(err, &soon) || asked != 1 || after != before {
		t.Errorf("Pay with the budget spent: %v, asked %d times, %d invoices then %d", err, asked, before, after)
	}
}

// R-117: a Pay that makes no invoice, refused by invoice create itself, spends none of the budget for everyone.
func TestLinkPayRefusedByCreateSpendsNoSharedBudget(t *testing.T) {
	e := invoiceAPI(t)
	// An active legacy link can still have incomplete setup. It must not spend the shared creation budget.
	for i := range 5 {
		r := e.call(t, "PUT", "/v1/profiles/"+e.walletless+"/links/ffffffff-0000-4000-8000-00000000000"+strconv.Itoa(i),
			"did:privy:alice", "", `{"title": "Junk", "amountUsd": "1", "active": false}`)
		slug, _ := r.body["slug"].(string)
		if r.status != http.StatusCreated {
			t.Fatalf("PUT junk link %d: %d %v", i, r.status, r.body)
		}
		e.exec(t, "UPDATE payment_links SET active = true WHERE slug = $1", slug)
		for j := range 5 {
			if r := e.call(t, "POST", "/v1/links/"+slug+"/pay", "", "j-"+strconv.Itoa(j), `{}`); r.status ==
				http.StatusTooManyRequests {
				t.Fatalf("junk Pay %d on link %d: %d %v", j, i, r.status, r.body)
			}
		}
	}
	r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/links/ffffffff-0000-4000-8000-000000000009",
		"did:privy:alice", "", `{"title": "Hourly", "amountUsd": "1"}`)
	if paid := e.call(t, "POST", "/v1/links/"+r.body["slug"].(string)+"/pay", "", "k", `{}`); paid.status !=
		http.StatusCreated {
		t.Fatalf("a payer's Pay after the junk: %d %v", paid.status, paid.body)
	}
}

// R-142: behind a trusted proxy Pay is limited per payer, so one stranger's requests can't stop a busy link for
// everyone. The address is the proxy's, the last in X-Forwarded-For: earlier ones are whatever the client sent.
func TestOneStrangerCantStopABusyLink(t *testing.T) {
	e := invoiceAPI(t)
	r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/links/eeeeeeee-0000-4000-8000-000000000001",
		"did:privy:alice", "", `{"title": "Hourly", "amountUsd": "1"}`)
	slug := r.body["slug"].(string)
	pay := func(forwarded, key string) reply {
		t.Helper()
		req, err := http.NewRequest("POST", e.srv.URL+"/v1/links/"+slug+"/pay", strings.NewReader(`{}`))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("X-Forwarded-For", forwarded)
		req.Header.Set("Idempotency-Key", key)
		return e.do(t, req)
	}
	for i := range 5 {
		if r := pay("198.51.100.7, 203.0.113.9", "s-"+strconv.Itoa(i)); r.status != http.StatusCreated {
			t.Fatalf("the stranger's Pay %d: %d %v", i, r.status, r.body)
		}
	}
	if r := pay("192.0.2.1, 203.0.113.9", "s-5"); errorCode(r) != "rate_limited" {
		t.Errorf("the stranger's sixth Pay, with another address forged before the proxy's: %d %v", r.status, r.body)
	}
	if r := pay("198.51.100.7", "p-0"); r.status != http.StatusCreated {
		t.Errorf("another payer on the same link: %d %v", r.status, r.body)
	}
	// An IPv6 network is one payer: its /64 gives it more addresses than any limit.
	for i := range 5 {
		if r := pay("2001:db8::"+strconv.Itoa(i+1), "v6-"+strconv.Itoa(i)); r.status != http.StatusCreated {
			t.Fatalf("Pay %d from one IPv6 network: %d %v", i, r.status, r.body)
		}
	}
	if r := pay("2001:db8::ffff:1", "v6-5"); errorCode(r) != "rate_limited" {
		t.Errorf("a sixth Pay from another address of the same /64: %d %v", r.status, r.body)
	}
}

// R-188: a link checkout that closed unpaid no longer counts toward the day's link quota, so strangers who open
// checkouts and never pay can't turn off a profile's links for the rest of the day.
func TestUnpaidClosedLinkCheckoutsDontUseUpTheDaysQuota(t *testing.T) {
	e := invoiceAPI(t)
	r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/links/eeeeeeee-0000-4000-8000-000000000001",
		"did:privy:alice", "", `{"title": "Hourly", "amountUsd": "1"}`)
	slug := r.body["slug"].(string)
	first := e.call(t, "POST", "/v1/links/"+slug+"/pay", "", "k-0", `{}`)
	if first.status != http.StatusCreated {
		t.Fatalf("Pay: %d %v", first.status, first.body)
	}
	// A day's quota of checkouts that closed unpaid.
	e.exec(t, `INSERT INTO invoices (id, profile_id, link_id, number, chain_id, chain_family, token_contract, amount,
		expires_at, settle_deadline, recipient_address, receive_method, factory_address, receive_address,
		idempotency_key, request_hash)
		SELECT '0x'||repeat(md5(n::text), 2), profile_id, link_id, 1000 + n, chain_id, chain_family, token_contract, amount,
		    1, settle_deadline, recipient_address, receive_method, factory_address, '0x'||lpad(to_hex(n), 40, '0'),
		    'quota-'||n, request_hash
		FROM invoices i CROSS JOIN generate_series(1, $2) n
		WHERE i.link_id = (SELECT id FROM payment_links WHERE slug = $1)`, slug, invoice.MaxPerDay)
	e.exec(t, "UPDATE invoices SET payment_status = 'expired' WHERE idempotency_key LIKE 'quota-%'")
	var n int
	if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM invoices WHERE link_id IS NOT NULL AND payment_status = 'expired'").Scan(&n); err != nil || n != invoice.MaxPerDay {
		t.Fatalf("closed unpaid checkouts = %d, %v", n, err)
	}
	if r := e.call(t, "POST", "/v1/links/"+slug+"/pay", "", "k-1", `{}`); r.status != http.StatusCreated {
		t.Errorf("Pay after a day of unpaid closed checkouts: %d %v", r.status, r.body)
	}
}
