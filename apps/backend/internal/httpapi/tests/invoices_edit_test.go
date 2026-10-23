package tests

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/history/historytest"
)

// R-127.
func TestOwnerEditsMemoClientEmailAndReturnLink(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	id := e.post(t, alice, e.aliceProfile, "key-1", `{"chainId": 84532, "token": "`+usdc+`", "amount": "5000000",
		"client": {"name": "Bob Ltd", "email": "ap@bob.example"}, "returnUrl": "https://shop.example/done"}`).
		body["invoiceId"].(string)
	put := func(profile, body string) reply {
		return e.call(t, "PUT", "/v1/profiles/"+profile+"/invoices/"+id+"/details", alice, "", body)
	}
	edit := `{"memo": "Split in two", "clientEmail": "pay@bob.example", "returnUrl": "https://shop.example/done"}`
	for range 2 {
		r := put(e.aliceProfile, edit)
		if r.status != http.StatusOK || r.body["memo"] != "Split in two" ||
			r.body["client"].(map[string]any)["email"] != "pay@bob.example" || r.body["returnUrl"] != "https://shop.example/done" {
			t.Fatalf("edit: %d %v", r.status, r.body)
		}
	}
	if r := put(e.aliceProfile, `{"memo": null, "clientEmail": "pay@bob.example"}`); r.status != http.StatusOK ||
		r.body["memo"] != nil || r.body["returnUrl"] != nil {
		t.Fatalf("clear: %d %v", r.status, r.body)
	}
	want := []string{"invoice.created by owner", `invoice.edited by owner {"field": "memo"}`,
		`invoice.edited by owner {"field": "clientEmail"}`, `invoice.edited by owner {"field": "memo"}`,
		`invoice.edited by owner {"field": "returnUrl"}`}
	if got := historytest.Events(t, e.pool, id); !slices.Equal(got, want) {
		t.Fatalf("history %q, want %q", got, want)
	}
	for body, status := range map[string]int{`{"clientEmail": "Bob <ap@bob.example>"}`: http.StatusUnprocessableEntity,
		`{"returnUrl": "http://shop.example"}`:          http.StatusUnprocessableEntity,
		`{"memo": "` + strings.Repeat("m", 2001) + `"}`: http.StatusUnprocessableEntity,
		`{"title": "New title"}`:                        http.StatusBadRequest} {
		if r := put(e.aliceProfile, body); r.status != status {
			t.Fatalf("%.60s: %d %v, want %d", body, r.status, r.body, status)
		}
	}
	// Another profile's invoice, also the same user's, is not found; Bob may not use Alice's profile.
	if r := put(e.walletless, edit); r.status != http.StatusNotFound || errorCode(r) != "invoice_not_found" {
		t.Fatalf("Alice's other profile: %d %v, want 404", r.status, r.body)
	}
	if r := put(e.bobProfile, edit); r.status != http.StatusForbidden {
		t.Fatalf("Bob's profile: %d, want 403", r.status)
	}
	if got := historytest.Events(t, e.pool, id); !slices.Equal(got, want) {
		t.Fatalf("history after refused edits %q, want %q", got, want)
	}
	if r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id, alice, "", ""); r.body["memo"] != nil ||
		r.body["client"].(map[string]any)["email"] != "pay@bob.example" {
		t.Fatalf("after refused edits: %v", r.body)
	}
	if _, ok := e.get(t, id).body["memo"]; ok {
		t.Fatal("the public read shows the memo")
	}
	if _, err := e.pool.Exec(t.Context(), "UPDATE invoices SET title = 'x' WHERE id = $1", id); err == nil {
		t.Fatal("the database let the title change")
	}
}
