package httpapi

import (
	"net/http"
	"reflect"
	"testing"
)

func TestGetBalances(t *testing.T) {
	e := invoiceAPI(t)
	r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/balances", "did:privy:alice", "", "")
	want := map[string]any{
		"estimatedUsdTotal": "2.50",
		"tokens": []any{map[string]any{"chainId": float64(84532), "token": usdc, "symbol": "USDC", "decimals": float64(6),
			"wallet": "2500000", "finalizedBlock": float64(100), "pending": "0", "held": "0"}},
	}
	if r.status != http.StatusOK || !reflect.DeepEqual(r.body, want) {
		t.Fatalf("got %d %v\nwant %v", r.status, r.body, want)
	}
	// A profile without a wallet: no balance and no total, never a made-up 0.
	r = e.call(t, "GET", "/v1/profiles/"+e.walletless+"/balances", "did:privy:alice", "", "")
	tokens, _ := r.body["tokens"].([]any)
	if r.status != http.StatusOK || r.body["estimatedUsdTotal"] != nil || len(tokens) != 1 ||
		tokens[0].(map[string]any)["wallet"] != nil || tokens[0].(map[string]any)["finalizedBlock"] != nil {
		t.Fatalf("walletless: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/balances", "", "", ""); r.status != http.StatusUnauthorized {
		t.Fatalf("without a token: %d", r.status)
	}
}

func TestGetActivity(t *testing.T) {
	e := invoiceAPI(t)
	path := "/v1/profiles/" + e.aliceProfile + "/activity"
	empty := e.call(t, "GET", path, "did:privy:alice", "", "")
	if empty.status != http.StatusOK || !reflect.DeepEqual(empty.body, map[string]any{"items": []any{}, "nextCursor": nil}) {
		t.Fatalf("new profile: %d %v", empty.status, empty.body)
	}
	first := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"]
	second := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", basicBody).body["invoiceId"]

	page := e.call(t, "GET", path+"?limit=1", "did:privy:alice", "", "")
	items, _ := page.body["items"].([]any)
	cursor, _ := page.body["nextCursor"].(string)
	if page.status != http.StatusOK || len(items) != 1 || cursor == "" {
		t.Fatalf("page 1: %d %v", page.status, page.body)
	}
	item := items[0].(map[string]any)
	if item["kind"] != "invoice" || item["invoiceId"] != second || item["status"] != "open" ||
		item["settlementStatus"] != "none" || item["amount"] != "5000000" || item["token"] != usdc {
		t.Fatalf("newest item %v, want the second invoice", item)
	}
	last := e.call(t, "GET", path+"?limit=1&cursor="+cursor, "did:privy:alice", "", "")
	items, _ = last.body["items"].([]any)
	if last.status != http.StatusOK || len(items) != 1 || items[0].(map[string]any)["invoiceId"] != first ||
		last.body["nextCursor"] != nil {
		t.Fatalf("page 2: %d %v", last.status, last.body)
	}

	for _, c := range []struct {
		query, code string
		status      int
	}{
		{"?limit=x", "malformed_request", http.StatusBadRequest},
		{"?limit=0", "invalid_value", http.StatusUnprocessableEntity},
		{"?limit=101", "invalid_value", http.StatusUnprocessableEntity},
		{"?cursor=nope", "invalid_value", http.StatusUnprocessableEntity},
	} {
		if r := e.call(t, "GET", path+c.query, "did:privy:alice", "", ""); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("%s: %d %v, want %d %s", c.query, r.status, r.body, c.status, c.code)
		}
	}
	if r := e.call(t, "GET", path, "", "", ""); r.status != http.StatusUnauthorized {
		t.Fatalf("without a token: %d", r.status)
	}
}
