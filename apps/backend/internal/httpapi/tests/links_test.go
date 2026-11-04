package tests

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
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
	for sent, saved := range map[string]string{"12.08": "12.08", "19.09": "19.09", "010": "10.00", "01.08": "1.08",
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
		`{"title": "A", "amountUsd": "0.99"}`:              "invalid_value",
		`{"title": "A", "minUsd": "0.50"}`:                 "invalid_value",
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
			"amount": "1000000"}`)
		e.exec(t, `ALTER TABLE invoices DISABLE TRIGGER invoices_guard`)
		e.exec(t, `UPDATE invoices SET link_id = $2, payment_status = $3 WHERE id = $1`, made.body["invoiceId"], fixedID,
			status)
		e.exec(t, `ALTER TABLE invoices ENABLE TRIGGER invoices_guard`)
	}
	if r := e.call(t, "GET", path(shop, fixedID), alice, "", ""); r.body["paid"] != 2.0 {
		t.Errorf("the paid count: %v", r.body["paid"])
	}
	// Another profile's invoice can't name the link, so it never counts.
	other := e.post(t, alice, e.aliceProfile, "link-other", `{"chainId": 84532, "token": "`+usdc+`", "amount": "1000000"}`)
	e.exec(t, `ALTER TABLE invoices DISABLE TRIGGER invoices_guard`)
	_, err := e.pool.Exec(context.Background(), `UPDATE invoices SET link_id = $2 WHERE id = $1`,
		other.body["invoiceId"], fixedID)
	e.exec(t, `ALTER TABLE invoices ENABLE TRIGGER invoices_guard`)
	if err == nil || !strings.Contains(err.Error(), "invoices_link_fkey") {
		t.Errorf("another profile's invoice names the link: %v", err)
	}
}

// A page of links reads as the whole list does, and one link reads as its list item.
func TestPaymentLinkPages(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	base := "/v1/profiles/" + shop + "/links"
	for i := 1; i <= 5; i++ {
		id := fmt.Sprintf("aaaaaaaa-0000-4000-8000-00000000000%d", i)
		if r := e.call(t, "PUT", base+"/"+id, alice, "", fmt.Sprintf(`{"title": "Link %d", "amountUsd": "5"}`, i)); r.status !=
			http.StatusCreated {
			t.Fatalf("create link %d: %d %v", i, r.status, r.body)
		}
	}
	// Two made at the same moment: the id breaks the tie.
	e.exec(t, `UPDATE payment_links SET created_at = (SELECT created_at FROM payment_links WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002')
		WHERE id = 'aaaaaaaa-0000-4000-8000-000000000004'`)
	whole := e.call(t, "GET", base, alice, "", "")
	all, _ := whole.body["links"].([]any)
	if whole.status != http.StatusOK || len(all) != 5 || whole.body["nextCursor"] != nil {
		t.Fatalf("the default page holds all 5: %d %v", whole.status, whole.body)
	}
	var want []any
	for _, l := range all {
		want = append(want, l.(map[string]any)["linkId"])
	}
	for limit := 1; limit <= 5; limit++ {
		var got []any
		cursor := ""
		for {
			url := fmt.Sprintf("%s?limit=%d", base, limit)
			if cursor != "" {
				url += "&cursor=" + cursor
			}
			r := e.call(t, "GET", url, alice, "", "")
			links, _ := r.body["links"].([]any)
			if r.status != http.StatusOK || len(links) > limit {
				t.Fatalf("limit %d: %d %v", limit, r.status, r.body)
			}
			for _, l := range links {
				got = append(got, l.(map[string]any)["linkId"])
			}
			next, _ := r.body["nextCursor"].(string)
			if cursor = next; cursor == "" {
				break
			}
		}
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("limit %d: %v, want %v", limit, got, want)
		}
	}
	for _, l := range all {
		item := l.(map[string]any)
		if r := e.call(t, "GET", base+"/"+item["linkId"].(string), alice, "", ""); r.status != http.StatusOK ||
			fmt.Sprint(r.body) != fmt.Sprint(item) {
			t.Fatalf("GET one link: %d %v, want its list item %v", r.status, r.body, item)
		}
	}
	for query, status := range map[string]int{"limit=0": http.StatusUnprocessableEntity,
		"limit=101": http.StatusUnprocessableEntity, "limit=x": http.StatusBadRequest,
		"cursor=bm90LWEtY3Vyc29y": http.StatusUnprocessableEntity} {
		if r := e.call(t, "GET", base+"?"+query, alice, "", ""); r.status != status {
			t.Errorf("%s: %d %v, want %d", query, r.status, r.body, status)
		}
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

// R-141, D-50: a link invoice is its payer's alone until its first deposit gives it the profile's next number.
func TestLinkInvoiceNumbers(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	const linkID = "cccccccc-0000-4000-8000-000000000001"
	if r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/links/"+linkID, alice, "", `{"title": "Hourly"}`); r.status !=
		http.StatusCreated {
		t.Fatalf("PUT link: %d %v", r.status, r.body)
	}
	body := `{"chainId": 84532, "token": "` + usdc + `", "amount": "2000000"}`
	first := e.post(t, alice, e.aliceProfile, "first", body)
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format(time.DateOnly)
	viaLink := func(key string) string {
		t.Helper()
		inv, _, err := invoice.NewService(e.pool).Create(t.Context(), e.aliceProfile, key, invoice.Request{ChainID: 84532,
			Token: usdc, Amount: "2000000", Details: invoice.Details{DueDate: yesterday}, LinkID: linkID})
		if err != nil || inv.Number != nil {
			t.Fatalf("a link invoice: number %v, %v", inv.Number, err)
		}
		return inv.ID
	}
	linked := viaLink("linked")
	second := e.post(t, alice, e.aliceProfile, "second", body)
	if first.body["number"] != 1.0 || second.body["number"] != 2.0 {
		t.Fatalf("numbers %v and %v, want 1 and 2", first.body["number"], second.body["number"])
	}

	// The payer's pay page and PDF show it without a number.
	paying := e.get(t, linked)
	if paying.status != http.StatusOK || paying.body["number"] != nil {
		t.Fatalf("the payer's read: %d %v", paying.status, paying.body)
	}
	pdf := e.pdf(t, linked, "invoice.pdf", "")
	if got := pdf.header.Get("Content-Disposition"); pdf.status != http.StatusOK ||
		got != `attachment; filename="forwend-invoice.pdf"` || strings.Contains(pdfText(t, pdf.body), "INV-") {
		t.Fatalf("the PDF: %d %q", pdf.status, got)
	}
	// Money can reach the owner's wallet from its address with no booked deposit: a settle or recover after its
	// deadline.
	e.exec(t, `INSERT INTO wallet_transfers (chain_id, chain_family, token_contract, wallet_address, direction,
		    counterparty, tx_hash, log_index, block_hash, block_number, block_time, amount, status)
		VALUES (84532, 'evm', $1, $2, 'in', $3, $4, 0, $4, 90, 90, 1000000, 'confirmed')`,
		usdc, aliceWallet, paying.body["receiveAddress"], "0x"+strings.Repeat("e", 64))
	// Billing reads and wallet attribution do not invent a document before its first booked payment.
	owner := "/v1/profiles/" + e.aliceProfile
	unseen := func(when string) {
		t.Helper()
		for _, path := range []string{"/invoices/" + linked, "/invoices/" + linked + "/cancel"} {
			method := map[bool]string{true: "POST", false: "GET"}[strings.HasSuffix(path, "cancel")]
			if r := e.call(t, method, owner+path, alice, "", ""); errorCode(r) != "invoice_not_found" {
				t.Errorf("%s: %s %s: %d %v", when, method, path, r.status, r.body)
			}
		}
		for _, path := range []string{"/invoices", "/invoices?q=" + paying.body["receiveAddress"].(string), "/owed",
			"/transactions"} {
			if r := e.call(t, "GET", owner+path, alice, "", ""); r.status != http.StatusOK ||
				strings.Contains(fmt.Sprint(r.body), linked) {
				t.Errorf("%s: GET %s: %d %v", when, path, r.status, r.body)
			}
		}
		revise := `{"chainId": 84532, "token": "` + usdc + `", "amount": "1000000", "replaces": "` + linked + `"}`
		if r := e.post(t, alice, e.aliceProfile, "revise-"+when, revise); errorCode(r) != "invoice_not_found" {
			t.Errorf("%s: revise it: %d %v", when, r.status, r.body)
		}
	}
	unseen("before money")
	// A detected deposit is not booked yet.
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT 84532, 'evm', $1, $2, $3, 0, $3, 95, extract(epoch FROM now())::bigint, $4, receive_address, 500000,
		    'detected' FROM invoices WHERE id = $2`, usdc, linked, "0x"+strings.Repeat("d", 64), aliceWallet)
	unseen("while detected")
	activity := e.call(t, "GET", owner+"/activity?status=confirming", alice, "", "")
	items := activity.body["items"].([]any)
	if activity.status != http.StatusOK || len(items) != 1 || items[0].(map[string]any)["invoiceId"] != linked ||
		items[0].(map[string]any)["kind"] != "deposit" || items[0].(map[string]any)["confirming"] != true {
		t.Fatalf("funded link attempt missing from Activity: %v", activity.body)
	}

	// Its first booked deposit gives it the next number; later invoices follow it with no gap.
	e.deposit(t, linked, "1000000")
	got := e.call(t, "GET", owner+"/invoices/"+linked, alice, "", "")
	third := e.post(t, alice, e.aliceProfile, "third", body)
	if got.status != http.StatusOK || got.body["number"] != 3.0 || third.body["number"] != 4.0 {
		t.Fatalf("after the deposit: %d %v, next %v", got.status, got.body["number"], third.body["number"])
	}
	numberedBy := ""
	for _, h := range got.body["history"].([]any) {
		if h := h.(map[string]any); h["kind"] == "invoice.numbered" {
			numberedBy = h["actor"].(string)
		}
	}
	if numberedBy != "system" {
		t.Errorf("the history: %v", got.body["history"])
	}
	list := e.call(t, "GET", owner+"/invoices", alice, "", "")
	if items, _ := list.body["items"].([]any); len(items) != 4 || items[1].(map[string]any)["invoiceId"] != linked {
		t.Fatalf("the list: %v", list.body)
	}
	if r := e.call(t, "GET", owner+"/owed", alice, "", ""); !strings.Contains(fmt.Sprint(r.body), linked) {
		t.Errorf("Owed: %v", r.body)
	}
	if r := e.get(t, linked); r.body["number"] != 3.0 {
		t.Errorf("the payer's read: %v", r.body["number"])
	}
	// Another link invoice, still without money, doesn't use a number.
	viaLink("unpaid")
	if r := e.post(t, alice, e.aliceProfile, "fifth", body); r.body["number"] != 5.0 {
		t.Errorf("the next number: %v", r.body["number"])
	}
	// When the payer picks the token, money on the second option numbers the whole invoice.
	e.exec(t, `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES (84532, 'evm', '0x3333333333333333333333333333333333333333', 'EURC', 2, true)`)
	choosing, _, err := invoice.NewService(e.pool).Create(t.Context(), e.aliceProfile, "choosing",
		invoice.Request{AmountUSD: "12.5", LinkID: linkID})
	if err != nil || len(choosing.Options) != 2 || choosing.Options[1].Token != usdc {
		t.Fatalf("a link invoice the payer picks the token of: %v %v", choosing.Options, err)
	}
	e.deposit(t, choosing.Options[1].ID, "1000000")
	var numbers []*int64
	if err := e.pool.QueryRow(context.Background(), `SELECT array_agg(number ORDER BY main_id NULLS FIRST)
		FROM invoices WHERE coalesce(main_id, id) = $1`, choosing.ID).Scan(&numbers); err != nil || len(numbers) != 2 ||
		numbers[0] == nil || *numbers[0] != 6 || numbers[1] == nil || *numbers[1] != 6 {
		t.Fatalf("the main row's and its options' numbers: %v %v", numbers, err)
	}
	// The number never changes once set.
	if _, err := e.pool.Exec(context.Background(), "UPDATE invoices SET number = NULL WHERE id = $1", linked); err == nil ||
		!strings.Contains(err.Error(), "never change") {
		t.Errorf("clearing the number: %v", err)
	}
}
