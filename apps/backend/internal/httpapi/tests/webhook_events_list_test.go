package tests

import (
	"context"
	"net/http"
	"reflect"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

// R-153, D-102: the last 30 days of a profile's invoice events, newest first, each with the body a webhook carries.
func TestWebhookEventsList(t *testing.T) {
	e := invoiceAPI(t)
	ctx := context.Background()
	const alice, dev = "did:privy:alice", "did:privy:erin"
	shop := e.merchant(t)
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+storeB, alice, "", `{"name": "Pro shop",
		"defaultExpiresIn": 3600}`); r.status != http.StatusCreated {
		t.Fatalf("PUT store: %d %v", r.status, r.body)
	}
	// A Developer who works with the second store only.
	e.exec(t, `WITH u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:erin') RETURNING id),
		     m AS (INSERT INTO profile_members (profile_id, user_id, role) SELECT $1, id, 'developer' FROM u RETURNING user_id)
		INSERT INTO member_stores (profile_id, user_id, store_id) SELECT $1, user_id, $2 FROM m`, shop, storeB)
	cancel := func(key, store string) string {
		t.Helper()
		body := `{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000"` + store + `}`
		id := e.post(t, alice, shop, key, body).body["invoiceId"].(string)
		if r := e.call(t, "POST", "/v1/profiles/"+shop+"/invoices/"+id+"/cancel", alice, "", ""); r.status != http.StatusOK {
			t.Fatalf("cancel: %d %v", r.status, r.body)
		}
		return id
	}
	first := cancel("key-1", "")
	second := cancel("key-2", `, "storeId": "`+storeB+`"`)
	if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error {
		return history.Add(ctx, tx, second, history.Held, history.System, history.Data{Amount: "5", Reason: "overpaid"})
	}); err != nil {
		t.Fatal(err)
	}
	// Nor another profile's: Alice's freelancer profile has one too.
	other := e.post(t, alice, e.aliceProfile, "key-other", basicBody).body["invoiceId"].(string)
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+other+"/cancel", alice, "", ""); r.status !=
		http.StatusOK {
		t.Fatalf("cancel the other profile's: %d %v", r.status, r.body)
	}
	// Neither a test event nor one from 31 days ago is listed.
	e.exec(t, "INSERT INTO webhook_events (profile_id, type, livemode) VALUES ($1, 'webhook.test', false)", shop)
	e.exec(t, `WITH h AS (INSERT INTO history_events (at, invoice_id, kind, actor) VALUES (now() - interval '31 days', $1,
		    'invoice.paid', 'system') RETURNING id)
		INSERT INTO webhook_events (history_id, profile_id, invoice_id, type, livemode, sequence, created_at)
		SELECT id, $2, $1, 'invoice.paid', false, 99, now() - interval '31 days' FROM h`, first, shop)

	list := func(user, query string) ([]map[string]any, any) {
		t.Helper()
		r := e.call(t, "GET", "/v1/profiles/"+shop+"/webhook-events"+query, user, "", "")
		if r.status != http.StatusOK {
			t.Fatalf("list %s: %d %v", query, r.status, r.body)
		}
		var items []map[string]any
		for _, item := range r.body["items"].([]any) {
			items = append(items, item.(map[string]any))
		}
		return items, r.body["nextCursor"]
	}
	what := func(items []map[string]any) [][2]any {
		var out [][2]any
		for _, item := range items {
			invoice := item["data"].(map[string]any)["invoice"].(map[string]any)["invoiceId"]
			out = append(out, [2]any{item["type"], invoice})
		}
		return out
	}

	items, next := list(alice, "")
	want := [][2]any{{"invoice.held", second}, {"invoice.canceled", second}, {"invoice.canceled", first}}
	if !reflect.DeepEqual(what(items), want) || next != nil {
		t.Fatalf("every event, newest first: %v (next %v), want %v", what(items), next, want)
	}
	// The invoice as its owner reads it: its history rows come only with the owner's read.
	invoice := items[0]["data"].(map[string]any)["invoice"].(map[string]any)
	if rows, _ := invoice["history"].([]any); len(rows) == 0 {
		t.Errorf("the body's invoice is not the owner's read: history %v", invoice["history"])
	}
	if held := items[0]; held["sequence"] != float64(2) || held["livemode"] != false ||
		!reflect.DeepEqual(held["data"].(map[string]any)["held"], map[string]any{"amount": "5", "reason": "overpaid",
			"optionId": nil}) {
		t.Errorf("the held event's body: %v", held)
	}

	// Pages: the cursor carries on from the last one without repeating an event.
	page, next := list(alice, "?limit=2")
	if !reflect.DeepEqual(what(page), want[:2]) || next == nil {
		t.Fatalf("the first page: %v, next %v", what(page), next)
	}
	page, next = list(alice, "?limit=2&cursor="+next.(string))
	if !reflect.DeepEqual(what(page), want[2:]) || next != nil {
		t.Fatalf("the second page: %v, next %v", what(page), next)
	}
	if items, _ := list(alice, "?limit=100"); !reflect.DeepEqual(what(items), want) {
		t.Errorf("a page of 100: %v", what(items))
	}
	if items, _ := list(alice, "?type=invoice.canceled"); !reflect.DeepEqual(what(items), want[1:]) {
		t.Errorf("only canceled: %v", what(items))
	}
	// A member of one store sees only its events.
	if items, _ := list(dev, ""); !reflect.DeepEqual(what(items), want[:2]) {
		t.Errorf("the second store's Developer: %v", what(items))
	}
	for _, bad := range []string{"?limit=0", "?limit=101", "?limit=x", "?type=invoice.created", "?type=webhook.test",
		"?cursor=abc", "?cursor=0"} {
		if r := e.call(t, "GET", "/v1/profiles/"+shop+"/webhook-events"+bad, alice, "", ""); errorCode(r) != "invalid_value" {
			t.Errorf("%s: %d %v", bad, r.status, r.body)
		}
	}
}
