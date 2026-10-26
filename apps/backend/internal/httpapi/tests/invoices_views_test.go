package tests

import (
	"net/http"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/invoiceapi"
)

// R-125.
func TestPayPageLoadsCountAsViews(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	owner := func() map[string]any {
		r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id, "did:privy:alice", "", "")
		return r.body["views"].(map[string]any)
	}
	if v := owner(); v["count"] != 0.0 || v["firstAt"] != nil || v["lastAt"] != nil {
		t.Fatalf("views before any load: %v", v)
	}
	view := func(token string) int {
		return e.call(t, "POST", "/v1/invoices/"+token+"/views", "", "", "").status
	}
	for range 2 {
		if status := view(e.link(t, id)); status != http.StatusNoContent {
			t.Fatalf("view: %d", status)
		}
	}
	v := owner()
	first, _ := v["firstAt"].(string)
	last, _ := v["lastAt"].(string)
	if v["count"] != 2.0 || !strings.HasSuffix(first, "Z") || !strings.HasSuffix(last, "Z") || last < first {
		t.Fatalf("views after two loads: %v; want 2 with UTC times", v)
	}
	// Per link, past the burst: refused, and not counted.
	counted, refused := 2.0, 0
	for range invoiceapi.ViewBurst {
		switch status := view(e.link(t, id)); status {
		case http.StatusNoContent:
			counted++
		case http.StatusTooManyRequests:
			refused++
		default:
			t.Fatalf("view past the burst: %d", status)
		}
	}
	if refused == 0 || owner()["count"] != counted {
		t.Fatalf("%d refused, count %v; want some refused and %v counted", refused, owner()["count"], counted)
	}
	// The on-chain id is public (D-86), so it counts nothing.
	if status := view(id); status != http.StatusNotFound {
		t.Fatalf("view by invoice id: %d, want 404", status)
	}
	if status := view(strings.Repeat("0", 64)); status != http.StatusNotFound {
		t.Fatalf("view by an unknown token: %d, want 404", status)
	}
	if _, ok := e.get(t, id).body["views"]; ok {
		t.Fatal("the public read shows the views")
	}
}
