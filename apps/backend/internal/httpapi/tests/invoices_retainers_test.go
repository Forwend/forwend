package tests

import (
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

// R-98.
func TestRepeatFromCreate(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	now := time.Now().UTC()
	first := time.Date(now.Year(), now.Month()+2, 1, 0, 0, 0, 0, time.UTC)
	due, next := first.Format(time.DateOnly), first.AddDate(0, 1, 0)
	base := `{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000", "dueDate": "` + due +
		`", "client": {"name": "Bob Ltd", "email": "ap@bob.example"}`
	r := e.post(t, alice, e.aliceProfile, "key-1", base+`, "repeat": {}}`)
	if r.status != http.StatusCreated {
		t.Fatalf("create with repeat: %d %v", r.status, r.body)
	}
	id := r.body["invoiceId"].(string)
	want := map[string]any{"endDate": nil, "nextDueDate": next.Format(time.DateOnly),
		"nextOn": next.AddDate(0, 0, -invoice.RetainerLead).Format(time.DateOnly), "stoppedAt": nil}
	if got := r.body["retainer"].(map[string]any); !reflect.DeepEqual(got, want) {
		t.Fatalf("retainer %v, want %v", got, want)
	}
	if again := e.post(t, alice, e.aliceProfile, "key-1", base+`, "repeat": {}}`); again.status != http.StatusOK ||
		again.body["invoiceId"] != id {
		t.Fatalf("same request: %d %v", again.status, again.body)
	}
	for _, body := range []string{base + "}", base + `, "repeat": {"endDate": "2099-01-01"}}`} {
		if other := e.post(t, alice, e.aliceProfile, "key-1", body); other.status != http.StatusConflict ||
			errorCode(other) != "idempotency_conflict" {
			t.Fatalf("same key, %s: %d %v, want 409", body, other.status, other.body)
		}
	}
	if plain := e.post(t, alice, e.aliceProfile, "key-2", base+"}"); plain.body["retainer"] != nil {
		t.Fatalf("an invoice that doesn't repeat: retainer %v, want null", plain.body["retainer"])
	}
	if _, ok := e.get(t, id).body["retainer"]; ok {
		t.Fatal("the public read shows the retainer")
	}

	for _, body := range []string{
		`{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000", "client": {"name": "Bob Ltd", "email": "ap@bob.example"}, "repeat": {}}`,
		`{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000", "dueDate": "` + due + `", "repeat": {}}`,
		base + `, "repeat": {"endDate": "2020-01-01"}}`,
		base + `, "repeat": {"endDate": "soon"}}`,
	} {
		if r := e.post(t, alice, e.aliceProfile, "key-3", body); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("%s: %d %v, want 422", body, r.status, r.body)
		}
	}

	stop := func(profile, as string) reply {
		return e.call(t, "POST", "/v1/profiles/"+profile+"/invoices/"+id+"/repeat/stop", as, "", "")
	}
	for range 2 {
		r := stop(e.aliceProfile, alice)
		ret, _ := r.body["retainer"].(map[string]any)
		if r.status != http.StatusOK || ret["stoppedAt"] == nil || ret["nextDueDate"] != nil || ret["nextOn"] != nil {
			t.Fatalf("stop: %d %v", r.status, r.body)
		}
	}
	if r := stop(e.bobProfile, alice); r.status != http.StatusForbidden {
		t.Fatalf("Bob's profile: %d %v, want 403", r.status, r.body)
	}

	// Stopped and ended retainers don't count toward the cap: with one ended among MaxRetainers more, one more fits.
	e.exec(t, `INSERT INTO retainers (profile_id, request, first_due, end_date)
		SELECT $1, '{}', '2026-01-01', CASE WHEN n = 1 THEN date '2026-02-01' END FROM generate_series(1, $2) n`,
		e.aliceProfile, invoice.MaxRetainers)
	if r := e.post(t, alice, e.aliceProfile, "key-4", base+`, "repeat": {}}`); r.status != http.StatusCreated {
		t.Fatalf("the last that fits: %d %v", r.status, r.body)
	}
	if r := e.post(t, alice, e.aliceProfile, "key-5", base+`, "repeat": {}}`); r.status != http.StatusUnprocessableEntity ||
		!strings.Contains(r.body["error"].(map[string]any)["message"].(string), "running retainers") {
		t.Fatalf("past the cap: %d %v, want 422", r.status, r.body)
	}
}
