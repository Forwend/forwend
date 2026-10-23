package tests

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"testing"
)

// R-117.
func TestJunkSpendsNoSharedLimit(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	random := func() string {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		return hex.EncodeToString(b)
	}
	const typed = `{"name": "Jane Doe", "email": "jane@bob.example"}`
	accepted := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/jobs", alice, "job-0", jobBody).body["token"].(string)
	if r := e.call(t, "POST", "/v1/jobs/"+accepted+"/accept", "", "", typed); r.status != http.StatusOK {
		t.Fatalf("accept: %d %v", r.status, r.body)
	}
	for range 40 {
		e.call(t, "PUT", "/v1/invoices/"+random()+"/payer-email", "", "", `{"email": "a@example.com"}`)
		e.call(t, "PUT", "/v1/invoices/"+random()+"/payer-email", "", "", `not json`)
		e.call(t, "POST", "/v1/jobs/"+random()+"/accept", "", "", typed)
		e.call(t, "POST", "/v1/jobs/"+random()+"/accept", "", "", `{}`)
		e.call(t, "POST", "/v1/jobs/"+random()+"/payments/2/accept", "", "", typed)
		// A quote payment is no change; a job already accepted changes nothing.
		e.call(t, "POST", "/v1/jobs/"+accepted+"/payments/1/accept", "", "",
			`{"name": "Jane Doe", "email": "jane@bob.example", "proposedAt": "0001-01-01T00:00:00Z"}`)
		e.call(t, "POST", "/v1/jobs/"+accepted+"/accept", "", "", typed)
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
