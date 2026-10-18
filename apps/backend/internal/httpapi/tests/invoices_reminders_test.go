package tests

import (
	"maps"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
)

// R-96, D-69: the owner turns reminders on for an open invoice with a due date and a client email; each worker round
// queues the latest due step once; the client's stop link stops them for good, and the owner can't turn them on again.
func TestPaymentReminders(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	day := func(days int) string { return time.Now().UTC().AddDate(0, 0, days).Format(time.DateOnly) }
	create := func(key, due, email string) string {
		t.Helper()
		body := `{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000"`
		if due != "" {
			body += `, "dueDate": "` + due + `"`
		}
		if email != "" {
			body += `, "client": {"name": "Client Ltd", "email": "` + email + `"}`
		}
		r := e.post(t, alice, e.aliceProfile, key, body+"}")
		if r.status != http.StatusCreated {
			t.Fatalf("create %s: %d %v", key, r.status, r.body)
		}
		return r.body["invoiceId"].(string)
	}
	set := func(id, body string) reply {
		return e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id+"/reminders", alice, "", body)
	}
	queued := func() map[string]string {
		t.Helper()
		if err := invoice.NewService(e.pool).QueueReminders(t.Context()); err != nil {
			t.Fatal(err)
		}
		rows, err := e.pool.Query(t.Context(), `SELECT invoice_id, string_agg(payload->>'step', ',' ORDER BY id)
			FROM outbox_events WHERE kind = 'invoice.reminder' GROUP BY invoice_id`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		out := map[string]string{}
		for rows.Next() {
			var id, steps string
			if err := rows.Scan(&id, &steps); err != nil {
				t.Fatal(err)
			}
			out[id] = steps
		}
		return out
	}

	early := create("early", day(4), "ap@client.example")
	before := create("before", day(3), "ap@client.example")
	due := create("due", day(0), "ap@client.example")
	late2 := create("late-2", day(-2), "ap@client.example")
	late7 := create("late-7", day(-7), "ap@client.example")
	off := create("off", day(-7), "ap@client.example")
	paid := create("paid", day(-7), "ap@client.example")
	for _, id := range []string{early, before, due, late2, late7, paid} {
		if r := set(id, `{"on": true}`); r.status != http.StatusOK || r.body["reminders"].(map[string]any)["on"] != true {
			t.Fatalf("turn on %s: %d %v", id, r.status, r.body)
		}
	}
	if r := set(off, `{"on": false}`); r.status != http.StatusOK || r.body["reminders"].(map[string]any)["on"] != false {
		t.Fatalf("turn off: %d %v", r.status, r.body)
	}
	e.exec(t, `UPDATE invoices SET payment_status = 'paid' WHERE id = $1`, paid)

	// The latest step whose day has come, once: a second round queues nothing more.
	want := map[string]string{before: "before", due: "due", late2: "due", late7: "after"}
	for range 2 {
		if got := queued(); !maps.Equal(got, want) {
			t.Fatalf("queued %v, want %v", got, want)
		}
	}
	owner := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+late7, alice, "", "")
	rem := owner.body["reminders"].(map[string]any)
	if emails := rem["emails"].([]any); len(emails) != 1 || emails[0].(map[string]any)["step"] != "after" ||
		emails[0].(map[string]any)["sentAt"] != nil || rem["stoppedAt"] != nil {
		t.Fatalf("owner's reminders %v", rem)
	}
	if _, ok := e.get(t, late7).body["reminders"]; ok {
		t.Fatal("the public read shows the reminders")
	}
	if r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/events", alice, "", ""); len(r.body["items"].([]any)) != 0 {
		t.Fatalf("bell events %v: reminders go to the client, not the owner", r.body)
	}

	// The client's stop link: the same answer twice, then nothing more is queued and the owner can't turn them on.
	var token string
	if err := e.pool.QueryRow(t.Context(), "SELECT stop_token FROM invoice_reminders WHERE invoice_id = $1", early).
		Scan(&token); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		r := e.call(t, "POST", "/v1/reminders/"+token+"/stop", "", "", "List-Unsubscribe=One-Click")
		if r.status != http.StatusOK || r.body["number"] != float64(1) || r.body["from"] != "Alice Design GmbH" {
			t.Fatalf("stop: %d %v", r.status, r.body)
		}
	}
	for _, bad := range []string{strings.Repeat("0", 64), "not-a-token"} {
		if r := e.call(t, "POST", "/v1/reminders/"+bad+"/stop", "", "", ""); r.status != http.StatusNotFound {
			t.Fatalf("token %s: %d %v, want 404", bad, r.status, r.body)
		}
	}
	if r := set(early, `{"on": true}`); r.status != http.StatusConflict || errorCode(r) != "reminders_stopped" {
		t.Fatalf("on after stop: %d %v, want 409 reminders_stopped", r.status, r.body)
	}
	if r := set(early, `{"on": false}`); r.status != http.StatusOK {
		t.Fatalf("off after stop: %d %v", r.status, r.body)
	}
	if stopped := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+early, alice, "", "").
		body["reminders"].(map[string]any)["stoppedAt"]; stopped == nil {
		t.Fatal("the owner's read does not say the client stopped them")
	}

	// On needs a due date, a client email and an invoice the payer can still pay; off and on are both required words.
	closed := create("closed", day(-1), "ap@client.example")
	e.closeCheckout(t, closed)
	for _, c := range []struct{ id, code string }{
		{create("undated", "", "ap@client.example"), "due_date_required"},
		{create("no-email", day(5), ""), "client_email_required"},
		{closed, "invoice_closed"},
	} {
		if r := set(c.id, `{"on": true}`); r.status != http.StatusConflict || errorCode(r) != c.code {
			t.Fatalf("%s: %d %v, want 409 %s", c.code, r.status, r.body, c.code)
		}
	}
	if r := set(early, `{}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("no on: %d %v, want 422", r.status, r.body)
	}
	if r := e.call(t, "PUT", "/v1/profiles/"+e.bobProfile+"/invoices/"+late7+"/reminders", alice, "", `{"on": true}`); r.status != http.StatusForbidden {
		t.Fatalf("Bob's profile: %d %v, want 403", r.status, r.body)
	}
	if r := set("0x"+strings.Repeat("0", 64), `{"on": true}`); r.status != http.StatusNotFound {
		t.Fatalf("unknown invoice: %d %v, want 404", r.status, r.body)
	}
}

// R-97: a saved client keeps whether its new invoices start with reminders on; a create with reminders turns them on
// at once, needs a due date and a client email, and the choice is part of the request an Idempotency-Key names.
func TestRemindersFromCreate(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	clients := "/v1/profiles/" + e.aliceProfile + "/clients/"
	if r := e.call(t, "PUT", clients+clientA, alice, "", `{"name": "Bob Ltd", "reminders": true}`); r.status != http.StatusCreated ||
		r.body["reminders"] != true {
		t.Fatalf("save client: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", clients+clientA, alice, "", `{"name": "Bob Ltd"}`); r.status != http.StatusOK || r.body["reminders"] != false {
		t.Fatalf("left out: %d %v, want false", r.status, r.body)
	}

	due := time.Now().UTC().AddDate(0, 0, 30).Format(time.DateOnly)
	base := `{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000", "dueDate": "` + due +
		`", "client": {"name": "Bob Ltd", "email": "ap@bob.example"}`
	r := e.post(t, alice, e.aliceProfile, "key-1", base+`, "reminders": true}`)
	if r.status != http.StatusCreated || r.body["reminders"].(map[string]any)["on"] != true {
		t.Fatalf("create with reminders: %d %v", r.status, r.body)
	}
	if again := e.post(t, alice, e.aliceProfile, "key-1", base+`, "reminders": true}`); again.status != http.StatusOK ||
		again.body["invoiceId"] != r.body["invoiceId"] {
		t.Fatalf("same request: %d %v", again.status, again.body)
	}
	if other := e.post(t, alice, e.aliceProfile, "key-1", base+"}"); other.status != http.StatusConflict ||
		errorCode(other) != "idempotency_conflict" {
		t.Fatalf("same key without reminders: %d %v, want 409", other.status, other.body)
	}
	for _, body := range []string{
		`{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000", "client": {"name": "Bob Ltd", "email": "ap@bob.example"}, "reminders": true}`,
		`{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000", "dueDate": "` + due + `", "reminders": true}`,
	} {
		if r := e.post(t, alice, e.aliceProfile, "key-2", body); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("%s: %d %v, want 422", body, r.status, r.body)
		}
	}
}
