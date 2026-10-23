package tests

import (
	"net/http"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/ensp1re/forwend/apps/backend/internal/history/historytest"
)

// R-124.
func TestOwnerReadsTheInvoiceHistory(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	hash := "0x" + strings.Repeat("ab", 32)
	e.exec(t, `INSERT INTO history_events (invoice_id, kind, actor, data) VALUES ($1, 'invoice.held', 'system', $2)`,
		id, `{"option": "`+id+`", "amount": "5", "txHash": "`+hash+`"}`)
	r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id+"/cancel", "did:privy:alice", "", "")
	if r.status != http.StatusOK {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	r = e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id, "did:privy:alice", "", "")
	var got []any
	for _, row := range r.body["history"].([]any) {
		h := row.(map[string]any)
		if h["at"] == nil || h["id"] == nil {
			t.Fatalf("row %v has no time or id", h)
		}
		delete(h, "at")
		delete(h, "id")
		got = append(got, h)
	}
	none := func(kind, actor string) map[string]any {
		return map[string]any{"kind": kind, "actor": actor, "optionId": nil, "amount": nil, "txHash": nil, "step": nil,
			"field": nil}
	}
	want := []any{none("invoice.canceled", "owner"),
		map[string]any{"kind": "invoice.held", "actor": "system", "optionId": id, "amount": "5", "txHash": hash,
			"step": nil, "field": nil},
		none("invoice.created", "owner")}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("history %v, want newest first %v", got, want)
	}
	if _, ok := e.get(t, id).body["history"]; ok {
		t.Fatal("the public read lists the history")
	}
}

// R-126: a row only when the setting changes, and each stop once.
func TestSettingChangesAreInTheHistory(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	due := time.Now().UTC().AddDate(0, 2, 0).Format(time.DateOnly)
	id := e.post(t, alice, e.aliceProfile, "key-1", `{"chainId": 84532, "token": "`+usdc+`", "amount": "5000000",
		"dueDate": "`+due+`", "client": {"email": "ap@bob.example"}, "repeat": {}}`).body["invoiceId"].(string)
	owned := "/v1/profiles/" + e.aliceProfile + "/invoices/" + id
	for _, on := range []string{"true", "true", "false", "true"} {
		if r := e.call(t, "PUT", owned+"/reminders", alice, "", `{"on": `+on+`}`); r.status != http.StatusOK {
			t.Fatalf("reminders %s: %d %v", on, r.status, r.body)
		}
	}
	var token string
	if err := e.pool.QueryRow(t.Context(), "SELECT stop_token FROM invoice_reminders WHERE invoice_id = $1", id).
		Scan(&token); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if r := e.call(t, "POST", "/v1/reminders/"+token+"/stop", "", "", ""); r.status != http.StatusOK {
			t.Fatalf("stop link: %d %v", r.status, r.body)
		}
		if r := e.call(t, "POST", owned+"/repeat/stop", alice, "", ""); r.status != http.StatusOK {
			t.Fatalf("stop repeating: %d %v", r.status, r.body)
		}
	}
	var got []string
	for _, row := range e.call(t, "GET", owned, alice, "", "").body["history"].([]any) {
		h := row.(map[string]any)
		got = append(got, h["kind"].(string)+" "+h["actor"].(string))
	}
	want := []string{"repeat.stopped owner", "reminders.stopped payer", "reminders.on owner", "reminders.off owner",
		"reminders.on owner", "invoice.created owner"}
	if !slices.Equal(got, want) {
		t.Fatalf("history %q, want newest first %q", got, want)
	}
}

// Two first changes at once: the second sees the first's row, so the history says what the setting became.
func TestFirstReminderChangesAtOnceAreBothInTheHistory(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	due := time.Now().UTC().AddDate(0, 2, 0).Format(time.DateOnly)
	id := e.post(t, alice, e.aliceProfile, "key-1", `{"chainId": 84532, "token": "`+usdc+`", "amount": "5000000",
		"dueDate": "`+due+`", "client": {"email": "ap@bob.example"}}`).body["invoiceId"].(string)
	// A first Reminders on, as SetReminders makes it, still open while the off below starts.
	on, err := e.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer on.Rollback(t.Context())
	if _, err := on.Exec(t.Context(), "SELECT 1 FROM invoices WHERE id = $1 FOR NO KEY UPDATE", id); err != nil {
		t.Fatal(err)
	}
	if _, err := on.Exec(t.Context(), `INSERT INTO invoice_reminders (invoice_id, enabled, stop_token)
		VALUES ($1, true, $2)`, id, strings.Repeat("cd", 32)); err != nil {
		t.Fatal(err)
	}
	if err := history.Add(t.Context(), on, id, history.RemindersOn, history.Owner, history.Data{}); err != nil {
		t.Fatal(err)
	}
	off := make(chan reply)
	go func() {
		off <- e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id+"/reminders", alice, "", `{"on": false}`)
	}()
	time.Sleep(300 * time.Millisecond)
	if err := on.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if r := <-off; r.status != http.StatusOK || r.body["reminders"].(map[string]any)["on"] != false {
		t.Fatalf("reminders off: %d %v", r.status, r.body)
	}
	if got, want := historytest.Events(t, e.pool, id), []string{"invoice.created by owner", "reminders.on by owner",
		"reminders.off by owner"}; !slices.Equal(got, want) {
		t.Fatalf("history %q, want %q", got, want)
	}
}
