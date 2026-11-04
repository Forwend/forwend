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

// R-177: the jobs list pages by its newest-first order and searches the title and client name; each item still sums all
// its own payments.
func TestJobPages(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	base := "/v1/profiles/" + e.aliceProfile + "/jobs"
	var ids []string
	for i := 1; i <= 5; i++ {
		body := strings.Replace(jobBody, `"Logo design"`, fmt.Sprintf(`"Logo design %d"`, i), 1)
		r := e.call(t, "POST", base, alice, fmt.Sprintf("job-page-%d", i), body)
		if r.status != http.StatusCreated {
			t.Fatalf("create job %d: %d %v", i, r.status, r.body)
		}
		ids = append(ids, r.body["jobId"].(string))
	}
	// Two made at the same moment: the id breaks the tie.
	e.exec(t, "UPDATE jobs SET created_at = (SELECT created_at FROM jobs WHERE id = $1) WHERE id = $2", ids[1], ids[3])
	whole := e.call(t, "GET", base, alice, "", "")
	all, _ := whole.body["items"].([]any)
	if whole.status != http.StatusOK || len(all) != 5 || whole.body["nextCursor"] != nil {
		t.Fatalf("the default page holds all 5: %d %v", whole.status, whole.body)
	}
	var want []any
	for _, j := range all {
		if j.(map[string]any)["payments"] != float64(2) || j.(map[string]any)["totalUsd"] != "1000.50" {
			t.Fatalf("job item %v, want its 2 payments summed", j)
		}
		want = append(want, j.(map[string]any)["jobId"])
	}
	for limit := 1; limit <= 5; limit++ {
		var got []any
		cursor := ""
		for {
			url := fmt.Sprintf("%s?limit=%d", base, limit)
			if cursor != "" {
				url += "&cursor=" + cursor
			}
			r := e.call(t, "GET", url, alice, "", "")
			items, _ := r.body["items"].([]any)
			if r.status != http.StatusOK || len(items) > limit {
				t.Fatalf("limit %d: %d %v", limit, r.status, r.body)
			}
			for _, j := range items {
				got = append(got, j.(map[string]any)["jobId"])
			}
			next, _ := r.body["nextCursor"].(string)
			if cursor = next; cursor == "" {
				break
			}
		}
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("limit %d: %v, want %v", limit, got, want)
		}
	}
	for q, want := range map[string]int{"design%203": 1, "BOB%20ltd": 5, "100%25": 0} {
		if items, _ := e.call(t, "GET", base+"?q="+q, alice, "", "").body["items"].([]any); len(items) != want {
			t.Errorf("q=%s: %d jobs, want %d", q, len(items), want)
		}
	}
	for query, status := range map[string]int{"limit=0": http.StatusUnprocessableEntity,
		"limit=101": http.StatusUnprocessableEntity, "limit=x": http.StatusBadRequest,
		"cursor=bm90LWEtY3Vyc29y": http.StatusUnprocessableEntity, "q=%20": http.StatusUnprocessableEntity} {
		if r := e.call(t, "GET", base+"?"+query, alice, "", ""); r.status != status {
			t.Errorf("%s: %d %v, want %d", query, r.status, r.body, status)
		}
	}
}

// R-100, R-101.
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
			"onAccept": true, "invoiceId": nil, "payToken": nil, "number": nil, "status": nil, "doneAt": nil, "deliveryLink": nil,
			"invoicedAt": nil, "paidAt": nil, "proposedAt": nil, "acceptedName": nil, "acceptedAt": nil,
			"acceptedEmail": nil, "clientEmailed": false},
		map[string]any{"position": float64(2), "title": "Final delivery", "amountUsd": "700.50", "dueDays": float64(14),
			"onAccept": false, "invoiceId": nil, "payToken": nil, "number": nil, "status": nil, "doneAt": nil, "deliveryLink": nil,
			"invoicedAt": nil, "paidAt": nil, "proposedAt": nil, "acceptedName": nil, "acceptedAt": nil,
			"acceptedEmail": nil, "clientEmailed": false},
	}
	if !reflect.DeepEqual(r.body["payments"], payments) {
		t.Fatalf("payments %v", r.body["payments"])
	}
	// "300.00" for "300" is the same request.
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
		{`"amountUsd": "300"`, `"amountUsd": "0.99"`},
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
		// D-86.
		if pay, _ := deposit["payToken"].(string); e.get(t, pay).body["invoiceId"] != deposit["invoiceId"] {
			t.Fatalf("deposit payToken %v opens no invoice %v", deposit["payToken"], deposit["invoiceId"])
		}
	}

	done := func(id string, position int, body string) reply {
		return e.call(t, "POST", fmt.Sprintf("%s/%s/payments/%d/done", jobs, id, position), alice, "", body)
	}
	waiting := e.call(t, "POST", jobs, alice, "job-5", jobBody).body["jobId"].(string)

	// R-105.
	change := `{"title": "Extra page", "amountUsd": "150", "dueDays": 7}`
	if r := e.call(t, "POST", jobs+"/"+waiting+"/payments", alice, "change-1", change); r.status != http.StatusConflict ||
		errorCode(r) != "job_not_accepted" {
		t.Fatalf("a change before acceptance: %d %v, want 409", r.status, r.body)
	}
	proposed := e.call(t, "POST", jobs+"/"+id+"/payments", alice, "change-1", change)
	third := proposed.body["payments"].([]any)[2].(map[string]any)
	if proposed.status != http.StatusCreated || third["proposedAt"] == nil || third["acceptedAt"] != nil ||
		third["clientEmailed"] != true {
		t.Fatalf("propose: %d %v", proposed.status, proposed.body)
	}
	if again := e.call(t, "POST", jobs+"/"+id+"/payments", alice, "change-1", change); again.status != http.StatusOK {
		t.Fatalf("same change again: %d %v", again.status, again.body)
	}
	if r := e.call(t, "POST", jobs+"/"+id+"/payments", alice, "change-x", change); r.status != http.StatusConflict ||
		errorCode(r) != "change_pending" {
		t.Fatalf("a second change while one waits: %d %v, want 409 change_pending", r.status, r.body)
	}
	if r := done(id, 3, `{}`); r.status != http.StatusConflict || errorCode(r) != "change_not_accepted" {
		t.Fatalf("mark an unaccepted change done: %d %v, want 409", r.status, r.body)
	}
	if r := done(id, 2, `{}`); r.status != http.StatusConflict || errorCode(r) != "change_pending" {
		t.Fatalf("the final while a change waits: %d %v, want 409 change_pending", r.status, r.body)
	}
	acceptChange := func(position int) reply {
		return e.call(t, "POST", fmt.Sprintf("/v1/jobs/%s/payments/%d/accept", token, position), "", "",
			fmt.Sprintf(`{"name": "Jane Doe", "email": "jane@bob.example", "proposedAt": %q}`, third["proposedAt"]))
	}
	if r := e.call(t, "POST", "/v1/jobs/"+token+"/payments/3/accept", "", "",
		`{"name": "Jane Doe", "email": "jane@bob.example"}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("accept without proposedAt: %d %v, want 422", r.status, r.body)
	}
	if r := acceptChange(1); r.status != http.StatusNotFound {
		t.Fatalf("accept a payment of the quote as a change: %d %v, want 404", r.status, r.body)
	}
	changed := acceptChange(3)
	changeRead := changed.body["payments"].([]any)[2].(map[string]any)
	_, emailed := changeRead["clientEmailed"]
	if _, ok := changeRead["acceptedEmail"]; changed.status != http.StatusOK || ok || emailed || changeRead["acceptedName"] != "Jane Doe" {
		t.Fatalf("accept the change: %d %v", changed.status, changed.body)
	}
	owner := e.call(t, "GET", jobs+"/"+id, alice, "", "").body["payments"].([]any)[2].(map[string]any)
	if owner["acceptedEmail"] != "jane@bob.example" {
		t.Fatalf("the owner's read of the change %v", owner)
	}
	if r := e.call(t, "DELETE", jobs+"/"+id+"/payments/3", alice, "", ""); r.status != http.StatusConflict ||
		errorCode(r) != "payment_not_withdrawable" {
		t.Fatalf("withdraw an accepted change: %d %v, want 409", r.status, r.body)
	}
	e.call(t, "POST", jobs+"/"+id+"/payments", alice, "change-2", change)
	if r := e.call(t, "DELETE", jobs+"/"+id+"/payments/4", alice, "", ""); r.status != http.StatusNoContent {
		t.Fatalf("withdraw: %d %v, want 204", r.status, r.body)
	}
	if r := e.call(t, "POST", jobs+"/"+id+"/payments", alice, "change-2", change); r.status != http.StatusOK ||
		len(r.body["payments"].([]any)) != 3 {
		t.Fatalf("retry the withdrawn change: %d %v, want 200 with 3 payments", r.status, r.body)
	}

	// R-103.
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
	if r := done(waiting, 2, `{}`); r.status != http.StatusConflict || errorCode(r) != "job_not_accepted" {
		t.Fatalf("before acceptance: %d %v, want 409 job_not_accepted", r.status, r.body)
	}
	e.call(t, "DELETE", jobs+"/"+waiting, alice, "", "")
	// R-105.
	if r := done(id, 3, `{}`); r.status != http.StatusOK {
		t.Fatalf("mark the accepted change done: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", jobs+"/"+id+"/payments", alice, "change-3", change); r.status != http.StatusConflict ||
		errorCode(r) != "job_finished" {
		t.Fatalf("a change on a finished job: %d %v, want 409 job_finished", r.status, r.body)
	}

	// R-101.
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
	// The accepted change counts in the total; the withdrawn one is gone.
	want := map[string]any{"jobId": id, "title": "Logo design", "clientName": "Bob Ltd", "totalUsd": "1150.50",
		"payments": float64(3), "paid": float64(0), "acceptedAt": owned.body["acceptedAt"], "createdAt": owned.body["createdAt"]}
	if !reflect.DeepEqual(items[0], want) {
		t.Fatalf("list item %v, want %v", items[0], want)
	}
	e.exec(t, "UPDATE invoices SET payment_status = 'paid' WHERE id = $1",
		owned.body["payments"].([]any)[0].(map[string]any)["invoiceId"])
	if paid := e.call(t, "GET", jobs, alice, "", "").body["items"].([]any)[0].(map[string]any)["paid"]; paid != float64(1) {
		t.Fatalf("paid %v after the deposit is paid, want 1", paid)
	}
}
