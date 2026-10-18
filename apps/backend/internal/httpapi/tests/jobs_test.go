package tests

import (
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

const jobBody = `{"title": "Logo design", "scope": "Three logo ideas, two rounds of changes.",
	"client": {"name": "Bob Ltd", "email": "ap@bob.example", "country": "GB"},
	"payments": [{"title": "Deposit", "amountUsd": "300", "dueDays": 7, "onAccept": true},
	             {"title": "Final delivery", "amountUsd": "700.50", "dueDays": 14}]}`

// R-100, R-101: the owner creates a job once per Idempotency-Key with a copy of the billing details; the client reads it by
// its link without the client block and accepts it once; the owner's list and read show each payment's invoice.
func TestJobs(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	jobs := "/v1/profiles/" + e.aliceProfile + "/jobs"
	r := e.call(t, "POST", jobs, alice, "job-1", jobBody)
	if r.status != http.StatusCreated || r.body["totalUsd"] != "1000.50" ||
		r.body["issuer"].(map[string]any)["name"] != "Alice Design GmbH" ||
		r.body["client"].(map[string]any)["email"] != "ap@bob.example" || r.body["acceptedAt"] != nil {
		t.Fatalf("create: %d %v", r.status, r.body)
	}
	id, token := r.body["jobId"].(string), r.body["token"].(string)
	payments := []any{
		map[string]any{"position": float64(1), "title": "Deposit", "amountUsd": "300.00", "dueDays": float64(7),
			"onAccept": true, "invoiceId": nil, "number": nil, "status": nil, "doneAt": nil, "deliveryLink": nil,
			"invoicedAt": nil, "paidAt": nil},
		map[string]any{"position": float64(2), "title": "Final delivery", "amountUsd": "700.50", "dueDays": float64(14),
			"onAccept": false, "invoiceId": nil, "number": nil, "status": nil, "doneAt": nil, "deliveryLink": nil,
			"invoicedAt": nil, "paidAt": nil},
	}
	if !reflect.DeepEqual(r.body["payments"], payments) {
		t.Fatalf("payments %v", r.body["payments"])
	}
	// The same values again, "300.00" for "300", replay; other values under the same key are a conflict.
	if again := e.call(t, "POST", jobs, alice, "job-1", strings.Replace(jobBody, `"300"`, `"300.00"`, 1)); again.status != http.StatusOK ||
		again.body["jobId"] != id {
		t.Fatalf("same request: %d %v", again.status, again.body)
	}
	if other := e.call(t, "POST", jobs, alice, "job-1", strings.Replace(jobBody, `"300"`, `"301"`, 1)); other.status != http.StatusConflict ||
		errorCode(other) != "idempotency_conflict" {
		t.Fatalf("same key, other amount: %d %v", other.status, other.body)
	}
	for _, bad := range []struct{ from, to string }{
		{`"title": "Logo design"`, `"title": ""`},
		{`"email": "ap@bob.example"`, `"email": ""`},
		{`"amountUsd": "300"`, `"amountUsd": "300.001"`},
		{`"amountUsd": "300"`, `"amountUsd": "0"`},
		{`"dueDays": 7`, `"dueDays": 91`},
		{`"dueDays": 14}`, `"dueDays": 14, "onAccept": true}`},
		{jobBody, `{"title": "Logo design", "client": {"name": "Bob Ltd", "email": "ap@bob.example"}, "payments": []}`},
	} {
		body := strings.Replace(jobBody, bad.from, bad.to, 1)
		if r := e.call(t, "POST", jobs, alice, "job-bad", body); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("%s: %d %v, want 422", bad.to, r.status, r.body)
		}
	}
	if r := e.call(t, "POST", "/v1/profiles/"+e.walletless+"/jobs", alice, "job-2", jobBody); r.status != http.StatusConflict ||
		errorCode(r) != "billing_details_required" {
		t.Fatalf("no billing details: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", "/v1/profiles/"+e.bobProfile+"/jobs", alice, "job-3", jobBody); r.status != http.StatusForbidden {
		t.Fatalf("Bob's profile: %d %v, want 403", r.status, r.body)
	}

	// The client's link: no client block, no typed email, no owner ids.
	public := e.call(t, "GET", "/v1/jobs/"+token, "", "", "")
	for _, owner := range []string{"client", "acceptedEmail", "jobId", "token"} {
		if _, ok := public.body[owner]; ok || public.status != http.StatusOK {
			t.Fatalf("public read: %d, has %s: %v", public.status, owner, public.body)
		}
	}
	for _, bad := range []string{strings.Repeat("0", 64), "not-a-token"} {
		if r := e.call(t, "GET", "/v1/jobs/"+bad, "", "", ""); r.status != http.StatusNotFound || errorCode(r) != "job_not_found" {
			t.Fatalf("token %s: %d %v, want 404", bad, r.status, r.body)
		}
	}
	accept := func(body string) reply { return e.call(t, "POST", "/v1/jobs/"+token+"/accept", "", "", body) }
	if r := e.call(t, "POST", "/v1/jobs/"+strings.Repeat("0", 64)+"/accept", "", "", `{"name": "Jane Doe", "email": "jane@bob.example"}`); r.status != http.StatusNotFound ||
		errorCode(r) != "job_not_found" {
		t.Fatalf("accept an unknown token: %d %v, want 404", r.status, r.body)
	}
	if r := accept(`{"name": "Jane Doe", "email": "not an email"}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("bad email: %d %v", r.status, r.body)
	}
	for range 2 {
		r := accept(`{"name": "Jane Doe", "email": "jane@bob.example"}`)
		deposit := r.body["payments"].([]any)[0].(map[string]any)
		if r.status != http.StatusOK || r.body["acceptedName"] != "Jane Doe" || r.body["acceptedAt"] == nil ||
			deposit["invoiceId"] == nil || deposit["number"] != float64(1) || deposit["status"] != "open" {
			t.Fatalf("accept: %d %v", r.status, r.body)
		}
		if _, ok := r.body["acceptedEmail"]; ok {
			t.Fatalf("accept answers the typed email: %v", r.body)
		}
	}

	// R-103: the next step marked done makes its invoice and keeps the delivery link, which the client's link shows.
	done := func(id string, position int, body string) reply {
		return e.call(t, "POST", fmt.Sprintf("%s/%s/payments/%d/done", jobs, id, position), alice, "", body)
	}
	if r := done(id, 9, `{}`); r.status != http.StatusNotFound {
		t.Fatalf("payment 9: %d %v, want 404", r.status, r.body)
	}
	if r := done(id, 2, `{"deliveryLink": "http://drive.example"}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("http link: %d %v, want 422", r.status, r.body)
	}
	marked := done(id, 2, `{"deliveryLink": "https://drive.example/logo"}`)
	final := marked.body["payments"].([]any)[1].(map[string]any)
	if marked.status != http.StatusOK || final["invoiceId"] == nil || final["doneAt"] == nil ||
		final["deliveryLink"] != "https://drive.example/logo" || final["status"] != "open" {
		t.Fatalf("mark done: %d %v", marked.status, marked.body)
	}
	if link := e.call(t, "GET", "/v1/jobs/"+token, "", "", "").body["payments"].([]any)[1].(map[string]any)["deliveryLink"]; link != "https://drive.example/logo" {
		t.Fatalf("the client's link shows delivery %v", link)
	}
	waiting := e.call(t, "POST", jobs, alice, "job-5", jobBody).body["jobId"].(string)
	if r := done(waiting, 2, `{}`); r.status != http.StatusConflict || errorCode(r) != "job_not_accepted" {
		t.Fatalf("before acceptance: %d %v, want 409 job_not_accepted", r.status, r.body)
	}
	e.call(t, "DELETE", jobs+"/"+waiting, alice, "", "")

	// R-101: an accepted job can't be deleted; one not accepted can, once.
	if r := e.call(t, "DELETE", jobs+"/"+id, alice, "", ""); r.status != http.StatusConflict || errorCode(r) != "job_accepted" {
		t.Fatalf("delete an accepted job: %d %v, want 409 job_accepted", r.status, r.body)
	}
	withdrawn := e.call(t, "POST", jobs, alice, "job-4", jobBody).body["jobId"].(string)
	if r := e.call(t, "DELETE", jobs+"/"+withdrawn, alice, "", ""); r.status != http.StatusNoContent {
		t.Fatalf("delete: %d %v, want 204", r.status, r.body)
	}
	for _, method := range []string{"GET", "DELETE"} {
		if r := e.call(t, method, jobs+"/"+withdrawn, alice, "", ""); r.status != http.StatusNotFound || errorCode(r) != "job_not_found" {
			t.Fatalf("%s after delete: %d %v, want 404", method, r.status, r.body)
		}
	}

	owned := e.call(t, "GET", jobs+"/"+id, alice, "", "")
	if owned.status != http.StatusOK || owned.body["acceptedEmail"] != "jane@bob.example" || owned.body["token"] != token {
		t.Fatalf("owner's read: %d %v", owned.status, owned.body)
	}
	if r := e.call(t, "GET", "/v1/profiles/"+e.bobProfile+"/jobs/"+id, alice, "", ""); r.status != http.StatusForbidden {
		t.Fatalf("Bob's profile read: %d %v, want 403", r.status, r.body)
	}
	if r := e.call(t, "GET", jobs+"/00000000-0000-0000-0000-000000000000", alice, "", ""); r.status != http.StatusNotFound {
		t.Fatalf("unknown job: %d %v, want 404", r.status, r.body)
	}
	list := e.call(t, "GET", jobs, alice, "", "")
	items := list.body["items"].([]any)
	if list.status != http.StatusOK || len(items) != 1 {
		t.Fatalf("list: %d %v", list.status, list.body)
	}
	want := map[string]any{"jobId": id, "title": "Logo design", "clientName": "Bob Ltd", "totalUsd": "1000.50",
		"payments": float64(2), "paid": float64(0), "acceptedAt": owned.body["acceptedAt"], "createdAt": owned.body["createdAt"]}
	if !reflect.DeepEqual(items[0], want) {
		t.Fatalf("list item %v, want %v", items[0], want)
	}
	e.exec(t, "UPDATE invoices SET payment_status = 'paid' WHERE id = $1",
		owned.body["payments"].([]any)[0].(map[string]any)["invoiceId"])
	if paid := e.call(t, "GET", jobs, alice, "", "").body["items"].([]any)[0].(map[string]any)["paid"]; paid != float64(1) {
		t.Fatalf("paid %v after the deposit is paid, want 1", paid)
	}
}
