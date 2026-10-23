package tests

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

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
	public := e.get(t, id).body
	if _, memo := public["memo"]; memo || len(public["updates"].([]any)) != 0 {
		t.Fatalf("the public read shows the memo or an edit the payer doesn't see: %v %v", public["memo"], public["updates"])
	}
	if _, err := e.pool.Exec(t.Context(), "UPDATE invoices SET title = 'x' WHERE id = $1", id); err == nil {
		t.Fatal("the database let the title change")
	}
}

// R-128.
func TestOwnerEditsReferenceNoteAndDueDateBeforePayment(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	day := func(days int) string { return time.Now().UTC().AddDate(0, 0, days).Format(time.DateOnly) }
	id := e.post(t, alice, e.aliceProfile, "key-1", `{"chainId": 84532, "token": "`+usdc+`", "amount": "5000000",
		"dueDate": "`+day(5)+`", "expiresIn": 2592000}`).body["invoiceId"].(string)
	put := func(body string) reply {
		return e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id+"/details", alice, "", body)
	}
	if r := put(`{"reference": "PO-9", "note": "Thanks", "dueDate": "` + day(10) + `"}`); r.status != http.StatusOK ||
		r.body["reference"] != "PO-9" || r.body["note"] != "Thanks" || r.body["dueDate"] != day(10) {
		t.Fatalf("edit: %d %v", r.status, r.body)
	}
	want := []string{"invoice.created by owner", `invoice.edited by owner {"field": "reference"}`,
		`invoice.edited by owner {"field": "note"}`,
		`invoice.edited by owner {"to": "` + day(10) + `", "from": "` + day(5) + `", "field": "dueDate"}`}
	if got := historytest.Events(t, e.pool, id); !slices.Equal(got, want) {
		t.Fatalf("history %q, want %q", got, want)
	}
	var fields []string
	for _, u := range e.get(t, id).body["updates"].([]any) {
		u := u.(map[string]any)
		fields = append(fields, fmt.Sprint(u["field"], " ", u["from"], " ", u["to"]))
	}
	if want := []string{"dueDate " + day(5) + " " + day(10), "note <nil> <nil>", "reference <nil> <nil>"}; !slices.Equal(fields, want) {
		t.Fatalf("the payer's updates %q, want newest first %q", fields, want)
	}
	for _, due := range []string{day(-1), day(31)} {
		if r := put(`{"reference": "PO-9", "note": "Thanks", "dueDate": "` + due + `"}`); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("due date %s: %d %v, want 422", due, r.status, r.body)
		}
	}

	// Once money is seen: these are locked, here and in the database; the memo still changes.
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT 84532, 'evm', $1, $2, $3, 0, $3, 1, 1, $4, receive_address, 1000000, 'detected' FROM invoices WHERE id = $2`,
		usdc, id, "0x"+strings.Repeat("ab", 32), aliceWallet)
	if r := put(`{"reference": "PO-9", "note": "Thanks again", "dueDate": "` + day(10) + `"}`); r.status != http.StatusConflict ||
		errorCode(r) != "invoice_not_editable" {
		t.Fatalf("after money: %d %v, want 409 invoice_not_editable", r.status, r.body)
	}
	if r := put(`{"memo": "Paid in part", "reference": "PO-9", "note": "Thanks", "dueDate": "` + day(10) + `"}`); r.status != http.StatusOK ||
		r.body["memo"] != "Paid in part" {
		t.Fatalf("memo after money: %d %v", r.status, r.body)
	}
	if _, err := e.pool.Exec(t.Context(), "UPDATE invoices SET note = 'x' WHERE id = $1", id); err == nil {
		t.Fatal("the database let the note change after money")
	}

	canceled := e.post(t, alice, e.aliceProfile, "key-2", basicBody).body["invoiceId"].(string)
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+canceled+"/cancel", alice, "", ""); r.status != http.StatusOK {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/invoices/"+canceled+"/details", alice, "",
		`{"note": "Too late"}`); r.status != http.StatusConflict || errorCode(r) != "invoice_not_editable" {
		t.Fatalf("a canceled invoice's note: %d %v, want 409", r.status, r.body)
	}
}
