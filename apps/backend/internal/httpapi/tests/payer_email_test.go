package tests

import (
	"net/http"
	"strings"
	"testing"
)

// R-82, D-68: the payer gives an address for the receipt on the public pay page; it changes until the receipt is sent,
// a paid invoice queues its receipt once, and the endpoint is limited per invoice.
func TestPayerEmail(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	put := func(id, body string) reply { return e.call(t, "PUT", "/v1/invoices/"+id+"/payer-email", "", "", body) }
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
		if r := e.call(t, "PUT", "/v1/invoices/"+id+"/payer-email", "", "", `{"email": "a@example.com"}`); r.status != http.StatusOK {
			t.Fatalf("change %d: %d %v", i, r.status, r.body)
		}
	}
	if r := e.call(t, "PUT", "/v1/invoices/"+id+"/payer-email", "", "", `{"email": "a@example.com"}`); r.status != http.StatusTooManyRequests ||
		errorCode(r) != "rate_limited" {
		t.Fatalf("fourth change: %d %v, want 429 rate_limited", r.status, r.body)
	}
	// Another invoice has its own budget.
	other := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", basicBody).body["invoiceId"].(string)
	if r := e.call(t, "PUT", "/v1/invoices/"+other+"/payer-email", "", "", `{"email": "a@example.com"}`); r.status != http.StatusOK {
		t.Fatalf("another invoice: %d %v", r.status, r.body)
	}
}
