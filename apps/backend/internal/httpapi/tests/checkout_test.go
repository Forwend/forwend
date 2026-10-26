package tests

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

func TestCheckoutSessionsReplayExpireAndExposeCanonicalPayments(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	base := "/v1/profiles/" + shop
	body := `{"storeId":"` + store + `","amountUsd":"2.00","reference":"order-42","title":"Coffee",
		"items":[{"description":"Coffee","quantity":"2","unitPrice":"1.00"}],"customer":{"email":"buyer@example.com"}}`
	created := e.call(t, "POST", base+"/checkout-sessions", alice, "purchase-42", body)
	if created.status != http.StatusCreated || created.body["status"] != "open" {
		t.Fatalf("create checkout: %d %v", created.status, created.body)
	}
	id := created.body["sessionId"].(string)
	payment := created.body["payment"].(map[string]any)
	if payment["paymentId"] != id || payment["reference"] != "order-42" || payment["number"] != nil ||
		payment["documentKind"] != "none" || payment["hostedUrl"] != webURL+"/pay/"+e.link(t, id) {
		t.Fatalf("checkout payment: %v", payment)
	}
	retry := e.call(t, "POST", base+"/checkout-sessions", alice, "purchase-42", strings.ReplaceAll(body, "2.00", "2.0"))
	if retry.status != http.StatusOK || retry.body["sessionId"] != id {
		t.Fatalf("normalized retry: %d %v", retry.status, retry.body)
	}
	for _, altered := range []string{
		strings.ReplaceAll(strings.ReplaceAll(body, "2.00", "4.00"), "1.00", "2.00"),
		strings.ReplaceAll(body, "order-42", "order-43"),
		strings.ReplaceAll(body, `"Coffee","quantity"`, `"Tea","quantity"`),
	} {
		if r := e.call(t, "POST", base+"/checkout-sessions", alice, "purchase-42", altered); r.status != http.StatusConflict {
			t.Fatalf("changed purchase: %d %v", r.status, r.body)
		}
	}
	for _, resource := range []string{"checkout-sessions", "payments"} {
		if r := e.call(t, "GET", base+"/"+resource+"/"+id, alice, "", ""); r.status != http.StatusOK {
			t.Fatalf("read %s: %d %v", resource, r.status, r.body)
		}
		if r := e.call(t, "GET", base+"/"+resource, alice, "", ""); r.status != http.StatusOK || len(r.body["items"].([]any)) != 1 {
			t.Fatalf("list unnumbered %s: %d %v", resource, r.status, r.body)
		}
	}
	if _, _, err := invoice.NewService(e.pool).Send(t.Context(), shop, id, "send-checkout", func() time.Duration { return 0 }); !errors.Is(err, invoice.ErrNotFound) {
		t.Fatalf("checkout sent as an invoice: %v", err)
	}
	for range 2 {
		if r := e.call(t, "POST", base+"/checkout-sessions/"+id+"/expire", alice, "", ""); r.status != http.StatusOK || r.body["status"] != "expired" {
			t.Fatalf("expire: %d %v", r.status, r.body)
		}
	}
	second := e.call(t, "POST", base+"/checkout-sessions", alice, "another-purchase", body)
	other := second.body["sessionId"].(string)
	e.deposit(t, other, "2000000")
	if r := e.call(t, "GET", base+"/checkout-sessions/"+other, alice, "", ""); r.body["status"] != "complete" ||
		r.body["payment"].(map[string]any)["settlementStatus"] != "pending" {
		t.Fatalf("paid, unsettled session: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", base+"/checkout-sessions/"+other+"/expire", alice, "", ""); r.status != http.StatusConflict {
		t.Fatalf("expired paid session: %d %v", r.status, r.body)
	}
	first := e.call(t, "GET", base+"/payments?limit=1", alice, "", "")
	last := e.call(t, "GET", base+"/payments?limit=1&cursor="+first.body["nextCursor"].(string), alice, "", "")
	if len(last.body["items"].([]any)) != 1 || last.body["nextCursor"] != nil ||
		first.body["items"].([]any)[0].(map[string]any)["paymentId"] == last.body["items"].([]any)[0].(map[string]any)["paymentId"] {
		t.Fatalf("payment pagination: %v, %v", first.body, last.body)
	}
}

func TestCheckoutBoundariesIncludeStoreRoleTenantKeyAndMode(t *testing.T) {
	e := invoiceAPI(t)
	const alice, bob = "did:privy:alice", "did:privy:bob"
	shop := e.merchant(t)
	first := storeIDs(t, e, shop)[0]
	base := "/v1/profiles/" + shop
	e.call(t, "PUT", base+"/stores/"+storeB, alice, "", `{"name":"Other","defaultExpiresIn":3600}`)
	body := func(store string) string { return `{"storeId":"` + store + `","amountUsd":"2"}` }
	a := e.call(t, "POST", base+"/checkout-sessions", alice, "first", body(first)).body["sessionId"].(string)
	b := e.call(t, "POST", base+"/checkout-sessions", alice, "second", body(storeB)).body["sessionId"].(string)
	if r := e.call(t, "POST", base+"/checkout-sessions", alice, "first", body(storeB)); r.status != http.StatusConflict {
		t.Fatalf("retry changes store: %d %v", r.status, r.body)
	}
	for _, request := range []string{`{"amountUsd":"2"}`, `{"storeId":"bad","amountUsd":"2"}`,
		`{"storeId":"` + first + `","amountUsd":"2.0000001"}`,
		`{"storeId":"` + first + `","amountUsd":"2","items":[{"description":"Coffee","quantity":"1","unitPrice":"3"}]}`} {
		if r := e.call(t, "POST", base+"/checkout-sessions", alice, "bad", request); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("invalid checkout: %d %v", r.status, r.body)
		}
	}
	if r := e.call(t, "GET", base+"/payments/"+a, bob, "", ""); r.status != http.StatusForbidden {
		t.Fatalf("other tenant read: %d %v", r.status, r.body)
	}
	e.exec(t, `INSERT INTO profile_members (profile_id, user_id, role)
		SELECT $1, id, 'developer' FROM users WHERE privy_user_id = $2`, shop, bob)
	e.exec(t, `INSERT INTO member_stores (profile_id, user_id, store_id)
		SELECT $1, id, $3 FROM users WHERE privy_user_id = $2`, shop, bob, first)
	for _, role := range []string{"developer", "finance"} {
		e.exec(t, "UPDATE profile_members SET role = $2 WHERE profile_id = $1", shop, role)
		for _, resource := range []string{"payments", "checkout-sessions"} {
			if r := e.call(t, "GET", base+"/"+resource+"/"+b, bob, "", ""); r.status != http.StatusNotFound {
				t.Fatalf("%s reads other store %s: %d %v", role, resource, r.status, r.body)
			}
			if r := e.call(t, "GET", base+"/"+resource, bob, "", ""); len(r.body["items"].([]any)) != 1 {
				t.Fatalf("%s list leaks store: %v", role, r.body)
			}
		}
	}
	key := e.call(t, "POST", base+"/keys", alice, "", `{"name":"Checkout","storeId":"`+first+
		`","scopes":["invoices.read","invoices.write"]}`).body["secret"].(string)
	for _, resource := range []string{"payments", "checkout-sessions"} {
		if r := e.withKey(t, "GET", base+"/"+resource+"/"+a, key, ""); r.status != http.StatusOK {
			t.Fatalf("key read: %d %v", r.status, r.body)
		}
		if r := e.withKey(t, "GET", base+"/"+resource+"/"+b, key, ""); r.status != http.StatusNotFound {
			t.Fatalf("key reads other store: %d %v", r.status, r.body)
		}
	}
	req, _ := http.NewRequest("POST", e.srv.URL+base+"/checkout-sessions", strings.NewReader(body(first)))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Idempotency-Key", "key-purchase")
	if r := e.do(t, req); r.status != http.StatusCreated {
		t.Fatalf("key creates checkout: %d %v", r.status, r.body)
	}
	e.exec(t, "UPDATE chains SET livemode = true WHERE chain_id = 84532")
	if r := e.withKey(t, "GET", base+"/payments/"+a, key, ""); r.status != http.StatusNotFound {
		t.Fatalf("test key reads live payment: %d %v", r.status, r.body)
	}
	req, _ = http.NewRequest("POST", e.srv.URL+base+"/checkout-sessions", strings.NewReader(body(first)))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Idempotency-Key", "key-purchase")
	if r := e.do(t, req); r.status != http.StatusConflict {
		t.Fatalf("retry mode mismatch: %d %v", r.status, r.body)
	}
	readKey := e.call(t, "POST", base+"/keys", alice, "", `{"name":"Reader","storeId":"`+first+
		`","scopes":["invoices.read"]}`).body["secret"].(string)
	if r := e.withKey(t, "POST", base+"/checkout-sessions", readKey, body(first)); r.status != http.StatusForbidden {
		t.Fatalf("read key creates payment: %d %v", r.status, r.body)
	}
	if r := e.withKey(t, "GET", base+"/checkout-sessions", key, ""); r.status != http.StatusOK || len(r.body["items"].([]any)) != 0 {
		t.Fatalf("test key list leaks live checkout: %d %v", r.status, r.body)
	}
}
