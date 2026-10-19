package tests

import (
	"net/http"
	"strings"
	"testing"
)

const clientBody = `{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000",
	"client": {"name": "Client Ltd", "email": "ap@client.example"}}`

// R-94: the owner sends an open invoice to its client's email: once per Idempotency-Key, once a day per invoice, 20 a
// day per profile, never a closed one; the owner's read lists each send, the public read and the bell do not.
func TestSendInvoiceToClient(t *testing.T) {
	e := invoiceAPI(t)
	send := func(profile, id, key string) reply {
		return e.call(t, "POST", "/v1/profiles/"+profile+"/invoices/"+id+"/send", "did:privy:alice", key, "")
	}
	sends := func(id string) (n int) {
		t.Helper()
		if err := e.pool.QueryRow(t.Context(), `SELECT count(*) FROM outbox_events WHERE invoice_id = $1 AND kind = 'invoice.sent'`,
			id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", clientBody).body["invoiceId"].(string)
	if r := send(e.aliceProfile, id, ""); r.status != http.StatusBadRequest {
		t.Fatalf("no Idempotency-Key: %d %v, want 400", r.status, r.body)
	}
	r := send(e.aliceProfile, id, "send-1")
	if r.status != http.StatusCreated || sends(id) != 1 {
		t.Fatalf("send: %d %v, %d queued", r.status, r.body, sends(id))
	}
	if s := r.body["sends"].([]any); len(s) != 1 || s[0].(map[string]any)["requestedAt"] == nil ||
		s[0].(map[string]any)["sentAt"] != nil {
		t.Fatalf("sends %v: want one, not sent yet", r.body["sends"])
	}
	if r := send(e.aliceProfile, id, "send-1"); r.status != http.StatusOK || sends(id) != 1 {
		t.Fatalf("same key again: %d, %d queued; want 200 and still one", r.status, sends(id))
	}
	if r := send(e.aliceProfile, id, "send-2"); r.status != http.StatusTooManyRequests || errorCode(r) != "rate_limited" {
		t.Fatalf("again within a day: %d %v, want 429", r.status, r.body)
	}
	e.exec(t, `UPDATE outbox_events SET created_at = now() - interval '25 hours', published_at = now() WHERE invoice_id = $1`, id)
	if r := send(e.aliceProfile, id, "send-2"); r.status != http.StatusCreated || sends(id) != 2 {
		t.Fatalf("a day later: %d %v, %d queued", r.status, r.body, sends(id))
	}
	owner := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id, "did:privy:alice", "", "")
	if s := owner.body["sends"].([]any); len(s) != 2 || s[0].(map[string]any)["sentAt"] == nil || s[1].(map[string]any)["sentAt"] != nil {
		t.Fatalf("owner's sends %v: want the first sent, the second waiting", owner.body["sends"])
	}
	if _, ok := e.get(t, id).body["sends"]; ok {
		t.Fatal("the public read lists the owner's sends")
	}
	if r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/events", "did:privy:alice", "", ""); len(r.body["items"].([]any)) != 0 {
		t.Fatalf("bell events %v: the owner's own send is not one", r.body)
	}

	// The key names one invoice: on another it is a conflict, not a second email.
	other := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", clientBody).body["invoiceId"].(string)
	if r := send(e.aliceProfile, other, "send-1"); r.status != http.StatusConflict || errorCode(r) != "idempotency_conflict" {
		t.Fatalf("key of another invoice: %d %v, want 409", r.status, r.body)
	}

	// No client email, or the payer can no longer pay: nothing to send.
	bare := e.post(t, "did:privy:alice", e.aliceProfile, "key-3", basicBody).body["invoiceId"].(string)
	if r := send(e.aliceProfile, bare, "send-3"); r.status != http.StatusConflict || errorCode(r) != "client_email_required" {
		t.Fatalf("no client email: %d %v, want 409", r.status, r.body)
	}
	closed := e.post(t, "did:privy:alice", e.aliceProfile, "key-4", clientBody).body["invoiceId"].(string)
	e.closeCheckout(t, closed)
	canceled := e.post(t, "did:privy:alice", e.aliceProfile, "key-5", clientBody).body["invoiceId"].(string)
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+canceled+"/cancel", "did:privy:alice", "", ""); r.status != http.StatusOK {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	paid := e.post(t, "did:privy:alice", e.aliceProfile, "key-6", clientBody).body["invoiceId"].(string)
	e.exec(t, `UPDATE invoices SET payment_status = 'paid' WHERE id = $1`, paid)
	for _, id := range []string{closed, canceled, paid} {
		if r := send(e.aliceProfile, id, "send-"+id); r.status != http.StatusConflict || errorCode(r) != "invoice_closed" {
			t.Fatalf("%s: %d %v, want 409 invoice_closed", id, r.status, r.body)
		}
	}

	// Another user's profile is forbidden; an unknown invoice is not found.
	if r := e.call(t, "POST", "/v1/profiles/"+e.bobProfile+"/invoices/"+id+"/send", "did:privy:alice", "send-4", ""); r.status != http.StatusForbidden {
		t.Fatalf("Bob's profile: %d %v, want 403", r.status, r.body)
	}
	if r := send(e.aliceProfile, "0x"+strings.Repeat("0", 64), "send-5"); r.status != http.StatusNotFound {
		t.Fatalf("unknown invoice: %d %v, want 404", r.status, r.body)
	}

	// 20 sends of the profile in the last day: the next one waits, whichever invoice it is.
	e.exec(t, `INSERT INTO outbox_events (kind, invoice_id, payload, idempotency_key)
		SELECT 'invoice.sent', $1, '{}', 'old-' || n FROM generate_series(1, 19) n`, closed)
	if r := send(e.aliceProfile, other, "send-6"); r.status != http.StatusTooManyRequests || errorCode(r) != "rate_limited" ||
		sends(other) != 0 {
		t.Fatalf("21st send of the day: %d %v, want 429", r.status, r.body)
	}
}

// R-116: the cap counts the user's client emails of every kind, from all their profiles: a second profile can't send
// once the first one used the day's emails (audit 2026-10-19: one account sent 120 across 6 profiles).
func TestClientEmailsCapCountsEveryProfileOfTheUser(t *testing.T) {
	e := invoiceAPI(t)
	e.exec(t, `INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		VALUES ($1, 'privy', 'w2', 'evm', '0x2222222222222222222222222222222222222223')`, e.walletless)
	e.exec(t, `INSERT INTO profile_billing_details (profile_id, name, address, country, contact_email)
		VALUES ($1, 'Alice Shop', 'Main St 2', 'DE', 'shop@alice.example')`, e.walletless)
	first := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", clientBody).body["invoiceId"].(string)
	second := e.post(t, "did:privy:alice", e.walletless, "key-1", clientBody)
	if second.status != http.StatusCreated {
		t.Fatalf("second profile's invoice: %d %v", second.status, second.body)
	}
	// 19 client emails of the first profile: Send to client and reminders.
	e.exec(t, `INSERT INTO outbox_events (kind, invoice_id, payload, idempotency_key)
		SELECT 'invoice.sent', $1, '{}', 'old-' || n FROM generate_series(1, 16) n`, first)
	e.exec(t, `INSERT INTO outbox_events (kind, invoice_id, payload)
		SELECT 'invoice.reminder', $1, jsonb_build_object('step', s) FROM unnest(ARRAY['before', 'due', 'after']) s`, first)
	send := func(profile, id, key string) int {
		return e.call(t, "POST", "/v1/profiles/"+profile+"/invoices/"+id+"/send", "did:privy:alice", key, "").status
	}
	if got := send(e.walletless, second.body["invoiceId"].(string), "send-1"); got != http.StatusCreated {
		t.Fatalf("the user's 20th client email: %d, want 201", got)
	}
	if got := send(e.aliceProfile, first, "send-2"); got != http.StatusTooManyRequests {
		t.Fatalf("the 21st, from the other profile: %d, want 429", got)
	}
}
