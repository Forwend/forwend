package tests

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// R-82, D-68: the payer gives an address for the receipt on the public pay page; it changes until the receipt is sent,
// a paid invoice queues its receipt once, and the endpoint is limited per invoice.
func TestPayerEmail(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	put := func(id, body string) reply {
		return e.call(t, "PUT", "/v1/invoices/"+e.link(t, id)+"/payer-email", "", "", body)
	}
	receipts := func() int {
		var n int
		if err := e.pool.QueryRow(t.Context(), `SELECT count(*) FROM outbox_events WHERE invoice_id = $1 AND kind = 'invoice.receipt'`,
			id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	other := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", basicBody).body["invoiceId"].(string)
	if r := put(other, `{"email": "not an address"}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("bad address: %d %v, want 422", r.status, r.body)
	}
	if r := put("0x"+strings.Repeat("0", 64), `{"email": "a@example.com"}`); r.status != http.StatusNotFound {
		t.Fatalf("unknown invoice: %d, want 404", r.status)
	}
	if r := put(id, `{"email": " Payer@Example.com "}`); r.status != http.StatusOK || r.body["email"] != "payer@example.com" ||
		receipts() != 0 {
		t.Fatalf("before paid: %d %v, receipts %d; want 204 and none queued", r.status, r.body, receipts())
	}
	var saved string
	if err := e.pool.QueryRow(t.Context(), "SELECT payer_email FROM invoices WHERE id = $1", id).Scan(&saved); err != nil ||
		saved != "payer@example.com" {
		t.Fatalf("saved %q (%v)", saved, err)
	}

	// Given once paid: queued now, once, and the address can still change until it is sent.
	e.exec(t, `UPDATE invoices SET payment_status = 'paid' WHERE id = $1`, id)
	if r := put(id, `{"email": "second@example.com"}`); r.status != http.StatusOK || receipts() != 1 {
		t.Fatalf("after paid: %d, receipts %d; want 204 and one queued", r.status, receipts())
	}
	e.exec(t, `UPDATE outbox_events SET published_at = now() WHERE invoice_id = $1 AND kind = 'invoice.receipt'`, id)
	if r := put(id, `{"email": "third@example.com"}`); r.status != http.StatusConflict || errorCode(r) != "receipt_sent" {
		t.Fatalf("after the receipt went out: %d %v, want 409 receipt_sent", r.status, r.body)
	}
	// The payer's receipt is not an owner event: the bell leaves it out.
	if r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/events", "did:privy:alice", "", ""); len(r.body["items"].([]any)) != 0 {
		t.Fatalf("bell events %v, want none", r.body)
	}
}

// A few changes per invoice, then 429 with Retry-After: the public endpoint can't be used to mail many addresses.
func TestPayerEmailIsLimitedPerInvoice(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	for i := range 3 {
		if r := e.call(t, "PUT", "/v1/invoices/"+e.link(t, id)+"/payer-email", "", "", `{"email": "a@example.com"}`); r.status != http.StatusOK {
			t.Fatalf("change %d: %d %v", i, r.status, r.body)
		}
	}
	if r := e.call(t, "PUT", "/v1/invoices/"+e.link(t, id)+"/payer-email", "", "", `{"email": "a@example.com"}`); r.status != http.StatusTooManyRequests ||
		errorCode(r) != "rate_limited" {
		t.Fatalf("fourth change: %d %v, want 429 rate_limited", r.status, r.body)
	}
	// Another invoice has its own budget.
	other := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", basicBody).body["invoiceId"].(string)
	if r := e.call(t, "PUT", "/v1/invoices/"+e.link(t, other)+"/payer-email", "", "", `{"email": "a@example.com"}`); r.status != http.StatusOK {
		t.Fatalf("another invoice: %d %v", r.status, r.body)
	}
}

// A paid invoice queues one receipt however often the address changes before it goes, and a receipt the worker gave
// up on starts again for the new address.
func TestPayerEmailQueuesOneReceipt(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	e.exec(t, `UPDATE invoices SET payment_status = 'paid' WHERE id = $1`, id)
	put := func(email string) {
		t.Helper()
		if r := e.call(t, "PUT", "/v1/invoices/"+e.link(t, id)+"/payer-email", "", "", `{"email": "`+email+`"}`); r.status != http.StatusOK {
			t.Fatalf("PUT %s: %d %v", email, r.status, r.body)
		}
	}
	put("a@example.com")
	e.exec(t, `UPDATE outbox_events SET attempts = 10, failed_at = now() WHERE invoice_id = $1`, id)
	put("b@example.com")
	var n, attempts int
	var failed bool
	if err := e.pool.QueryRow(t.Context(), `SELECT count(*), max(attempts), bool_or(failed_at IS NOT NULL) FROM outbox_events
		WHERE invoice_id = $1 AND kind = 'invoice.receipt'`, id).Scan(&n, &attempts, &failed); err != nil {
		t.Fatal(err)
	}
	if n != 1 || attempts != 0 || failed {
		t.Fatalf("receipts %d, attempts %d, given up %v; want one, started again", n, attempts, failed)
	}
	if r := e.call(t, "PUT", "/v1/invoices/"+e.link(t, id)+"/payer-email", "", "", `{"email": 1}`); r.status != http.StatusBadRequest {
		t.Fatalf("a number for email: %d %v, want 400", r.status, r.body)
	}
}

// Everyone together gets a few receipts a second, so many paid invoices can't be used to mail many addresses. Only a
// receipt that goes out spends that budget (R-117).
func TestPayerEmailIsLimitedForEveryone(t *testing.T) {
	e := invoiceAPI(t)
	var links []string
	for i := range 25 {
		id := e.post(t, "did:privy:alice", e.aliceProfile, fmt.Sprint("key-", i), basicBody).body["invoiceId"].(string)
		e.exec(t, `UPDATE invoices SET payment_status = 'paid' WHERE id = $1`, id)
		links = append(links, e.link(t, id))
	}
	limited := 0
	for _, link := range links {
		if r := e.call(t, "PUT", "/v1/invoices/"+link+"/payer-email", "", "", `{"email": "a@example.com"}`); r.status == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Fatal("25 receipts at once on 25 paid invoices: none limited")
	}
}

// A change while the worker sends the receipt waits for that send, then says it was sent: never "on its way" to an
// address the email did not go to.
func TestPayerEmailWaitsForASendInProgress(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	e.exec(t, `UPDATE invoices SET payment_status = 'paid' WHERE id = $1`, id)
	if r := e.call(t, "PUT", "/v1/invoices/"+e.link(t, id)+"/payer-email", "", "", `{"email": "a@example.com"}`); r.status != http.StatusOK {
		t.Fatalf("first address: %d %v", r.status, r.body)
	}
	// The worker's send: it holds the receipt row until Resend answers.
	tx, err := e.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	if _, err := tx.Exec(t.Context(), `SELECT 1 FROM outbox_events WHERE invoice_id = $1 AND kind = 'invoice.receipt'
		FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}
	answer := make(chan reply, 1)
	go func() {
		answer <- e.call(t, "PUT", "/v1/invoices/"+e.link(t, id)+"/payer-email", "", "", `{"email": "b@example.com"}`)
	}()
	select {
	case r := <-answer:
		t.Fatalf("the change did not wait for the send: %d %v", r.status, r.body)
	case <-time.After(300 * time.Millisecond):
	}
	if _, err := tx.Exec(t.Context(), `UPDATE outbox_events SET published_at = now(), attempts = 1
		WHERE invoice_id = $1 AND kind = 'invoice.receipt'`, id); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if r := <-answer; r.status != http.StatusConflict || errorCode(r) != "receipt_sent" {
		t.Fatalf("after the send: %d %v, want 409 receipt_sent", r.status, r.body)
	}
}
