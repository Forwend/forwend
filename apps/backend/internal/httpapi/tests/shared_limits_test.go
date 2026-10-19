package tests

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"testing"
)

// R-117: requests with an unknown link or a bad body spend nothing of a limit shared by everyone, so junk traffic
// can't block the owner's Send to client or a client's accept (audit 2026-10-19).
func TestJunkSpendsNoSharedLimit(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	random := func() string {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		return hex.EncodeToString(b)
	}
	for range 40 {
		e.call(t, "PUT", "/v1/invoices/"+random()+"/payer-email", "", "", `{"email": "a@example.com"}`)
		e.call(t, "PUT", "/v1/invoices/"+random()+"/payer-email", "", "", `not json`)
		e.call(t, "POST", "/v1/jobs/"+random()+"/accept", "", "", `{"name": "Jane Doe", "email": "jane@bob.example"}`)
		e.call(t, "POST", "/v1/jobs/"+random()+"/accept", "", "", `{}`)
	}
	id := e.post(t, alice, e.aliceProfile, "key-1", clientBody).body["invoiceId"].(string)
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id+"/send", alice, "send-1", ""); r.status != http.StatusCreated {
		t.Fatalf("Send to client after junk: %d %v, want 201", r.status, r.body)
	}
	job := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/jobs", alice, "job-1", jobBody).body["token"].(string)
	if r := e.call(t, "POST", "/v1/jobs/"+job+"/accept", "", "", `{"name": "Jane Doe", "email": "jane@bob.example"}`); r.status != http.StatusOK {
		t.Fatalf("a real accept after junk: %d %v, want 200", r.status, r.body)
	}
}
