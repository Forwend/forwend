package tests

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

const (
	clientA = "11111111-1111-4111-8111-111111111111"
	clientB = "22222222-2222-4222-8222-222222222222"
)

// R-86.
func TestClients(t *testing.T) {
	e := invoiceAPI(t)
	const alice, bob = "did:privy:alice", "did:privy:bob"
	path := "/v1/profiles/" + e.aliceProfile + "/clients"
	list := func(user string) reply { return e.call(t, "GET", path, user, "", "") }
	clients := func(r reply) []any { c, _ := r.body["items"].([]any); return c }

	if r := list(alice); r.status != http.StatusOK || len(clients(r)) != 0 {
		t.Fatalf("empty list: %d %v", r.status, r.body)
	}
	full := `{"name": "Bob Ltd", "email": "ap@bob.example", "address": "Main St 1\nBerlin", "country": "DE",
		"taxId": "DE999999999", "reference": "PO-4500012345"}`
	made := e.call(t, "PUT", path+"/"+clientB, alice, "", full)
	if made.status != http.StatusCreated {
		t.Fatalf("PUT new: %d %v", made.status, made.body)
	}
	delete(made.body, "updatedAt")
	want := map[string]any{"clientId": clientB, "name": "Bob Ltd", "email": "ap@bob.example",
		"address": "Main St 1\nBerlin", "country": "DE", "taxId": "DE999999999", "reference": "PO-4500012345",
		"reminders": false}
	if !reflect.DeepEqual(made.body, want) {
		t.Fatalf("PUT returned %v, want %v", made.body, want)
	}
	if again := e.call(t, "PUT", path+"/"+clientB, alice, "", full); again.status != http.StatusOK {
		t.Fatalf("PUT again: %d %v", again.status, again.body)
	}
	if r := e.call(t, "PUT", path+"/"+clientA, alice, "", `{"name": "anna"}`); r.status != http.StatusCreated ||
		r.body["email"] != nil || r.body["country"] != nil || r.body["taxId"] != nil || r.body["reference"] != nil {
		t.Fatalf("PUT name only: %d %v", r.status, r.body)
	}
	if got := clients(list(alice)); len(got) != 2 || got[0].(map[string]any)["name"] != "anna" ||
		got[1].(map[string]any)["name"] != "Bob Ltd" {
		t.Fatalf("list by name: %v", got)
	}

	invoice := e.post(t, alice, e.aliceProfile, "key-1", `{"chainId": 84532, "token": "`+usdc+`", "amount": "1000000",
		"client": `+strings.Replace(full, `, "reference": "PO-4500012345"`, "", 1)+`}`)
	if invoice.status != http.StatusCreated {
		t.Fatalf("invoice: %d %v", invoice.status, invoice.body)
	}
	if r := e.call(t, "PUT", path+"/"+clientB, alice, "", `{"name": "Bob GmbH"}`); r.status != http.StatusOK ||
		r.body["name"] != "Bob GmbH" || r.body["taxId"] != nil {
		t.Fatalf("PUT replaces every field: %d %v", r.status, r.body)
	}
	if r := e.call(t, "DELETE", path+"/"+clientB, alice, "", ""); r.status != http.StatusNoContent {
		t.Fatalf("DELETE: %d %v", r.status, r.body)
	}
	if r := e.call(t, "DELETE", path+"/"+clientB, alice, "", ""); r.status != http.StatusNotFound || errorCode(r) != "client_not_found" {
		t.Fatalf("DELETE again: %d %v", r.status, r.body)
	}
	got := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+invoice.body["invoiceId"].(string), alice, "", "")
	if c := got.body["client"].(map[string]any); c["name"] != "Bob Ltd" || c["taxId"] != "DE999999999" {
		t.Fatalf("the invoice changed with its client: %v", c)
	}

	if r := list(bob); r.status != http.StatusForbidden {
		t.Fatalf("Bob lists Alice's clients: %d", r.status)
	}
	for _, method := range []string{"PUT", "DELETE"} {
		if r := e.call(t, method, path+"/"+clientA, bob, "", `{"name": "x"}`); r.status != http.StatusForbidden {
			t.Fatalf("Bob %s Alice's client: %d", method, r.status)
		}
		if r := e.call(t, method, path+"/"+clientA, "", "", `{"name": "x"}`); r.status != http.StatusUnauthorized {
			t.Fatalf("%s without a token: %d", method, r.status)
		}
	}
	bobPath := "/v1/profiles/" + e.bobProfile + "/clients/" + clientA
	if r := e.call(t, "PUT", bobPath, bob, "", `{"name": "taken"}`); r.status != http.StatusNotFound || errorCode(r) != "client_not_found" {
		t.Fatalf("Bob saves over Alice's client id: %d %v", r.status, r.body)
	}
	if r := e.call(t, "DELETE", bobPath, bob, "", ""); r.status != http.StatusNotFound {
		t.Fatalf("Bob deletes Alice's client: %d %v", r.status, r.body)
	}
	if got := clients(list(alice)); len(got) != 1 || got[0].(map[string]any)["name"] != "anna" {
		t.Fatalf("Bob changed Alice's clients: %v", got)
	}

	for _, c := range []struct {
		field, value, code string
		status             int
	}{
		{"name", `""`, "invalid_value", http.StatusUnprocessableEntity},
		{"name", `"` + strings.Repeat("é", 201) + `"`, "invalid_value", http.StatusUnprocessableEntity},
		{"name", `"A\u0000"`, "invalid_value", http.StatusUnprocessableEntity},
		{"email", `"not an email"`, "invalid_value", http.StatusUnprocessableEntity},
		{"email", `"Bob <b@example.com>"`, "invalid_value", http.StatusUnprocessableEntity},
		{"address", `"` + strings.Repeat("a", 501) + `"`, "invalid_value", http.StatusUnprocessableEntity},
		{"country", `"de"`, "invalid_value", http.StatusUnprocessableEntity},
		{"country", `"XK"`, "invalid_value", http.StatusUnprocessableEntity},
		{"taxId", `"` + strings.Repeat("1", 51) + `"`, "invalid_value", http.StatusUnprocessableEntity},
		{"reference", `"` + strings.Repeat("1", 101) + `"`, "invalid_value", http.StatusUnprocessableEntity},
		{"reference", `"PO\n1"`, "invalid_value", http.StatusUnprocessableEntity},
		{"phone", `"123"`, "malformed_request", http.StatusBadRequest},
	} {
		body := map[string]json.RawMessage{"name": json.RawMessage(`"Carol"`)}
		body[c.field] = json.RawMessage(c.value)
		raw, _ := json.Marshal(body)
		if r := e.call(t, "PUT", path+"/"+clientB, alice, "", string(raw)); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("PUT %s: %d %v, want %d %s", raw, r.status, r.body, c.status, c.code)
		}
	}
	if r := e.call(t, "PUT", path+"/not-a-uuid", alice, "", `{"name": "Carol"}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("PUT with a malformed id: %d %v", r.status, r.body)
	}
	if r := e.call(t, "DELETE", path+"/not-a-uuid", alice, "", ""); r.status != http.StatusNotFound {
		t.Fatalf("DELETE with a malformed id: %d %v", r.status, r.body)
	}

	// The cap is 1000 clients; concurrent saves are in TestSaveClientCapCountsASaveInFlight.
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO clients (profile_id, name)
		SELECT $1, 'filler ' || n FROM generate_series(1, 999) n`, e.aliceProfile); err != nil {
		t.Fatal(err)
	}
	if r := e.call(t, "PUT", path+"/"+clientB, alice, "", `{"name": "one too many"}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("PUT the 1001st client: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path+"/"+clientA, alice, "", `{"name": "Anna"}`); r.status != http.StatusOK {
		t.Fatalf("PUT an existing client when full: %d %v", r.status, r.body)
	}
}

// R-177: the client page reads one client by id; another profile's, an unknown or a malformed id is not found.
func TestClientReadByID(t *testing.T) {
	e := invoiceAPI(t)
	const alice, bob = "did:privy:alice", "did:privy:bob"
	path := "/v1/profiles/" + e.aliceProfile + "/clients/"
	if r := e.call(t, "PUT", path+clientA, alice, "", `{"name": "Bob Ltd", "email": "ap@bob.example"}`); r.status !=
		http.StatusCreated {
		t.Fatalf("PUT client: %d %v", r.status, r.body)
	}
	listed := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/clients", alice, "", "").body["items"].([]any)[0]
	if r := e.call(t, "GET", path+clientA, alice, "", ""); r.status != http.StatusOK || !reflect.DeepEqual(r.body, listed) {
		t.Fatalf("GET one client: %d %v, want its list item %v", r.status, r.body, listed)
	}
	for _, id := range []string{clientB, "not-a-uuid"} {
		if r := e.call(t, "GET", path+id, alice, "", ""); r.status != http.StatusNotFound || errorCode(r) != "client_not_found" {
			t.Errorf("GET %s: %d %v, want 404", id, r.status, r.body)
		}
	}
	if r := e.call(t, "GET", "/v1/profiles/"+e.bobProfile+"/clients/"+clientA, bob, "", ""); r.status != http.StatusNotFound {
		t.Errorf("Bob reads Alice's client on his profile: %d %v, want 404", r.status, r.body)
	}
	if r := e.call(t, "GET", path+clientA, bob, "", ""); r.status != http.StatusForbidden {
		t.Errorf("Bob reads Alice's profile: %d, want 403", r.status)
	}
}

// R-177: the clients list reads one page at a time by name, and q searches the name, the email and the tax ID.
func TestClientPages(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	path := "/v1/profiles/" + e.aliceProfile + "/clients"
	// Names that sort by letter case and accents, and two with the same name: the id breaks the tie.
	for i, name := range []string{"bob", "Alice", "Émile", "alice", "Zoë", "Bob"} {
		id := fmt.Sprintf("aaaaaaaa-0000-4000-8000-%012d", i+1)
		body := fmt.Sprintf(`{"name": %q, "email": "client%d@example.com", "taxId": "DE00%d"}`, name, i+1, i+1)
		if r := e.call(t, "PUT", path+"/"+id, alice, "", body); r.status != http.StatusCreated {
			t.Fatalf("PUT %s: %d %v", name, r.status, r.body)
		}
	}
	whole := e.call(t, "GET", path, alice, "", "")
	all, _ := whole.body["items"].([]any)
	if whole.status != http.StatusOK || len(all) != 6 || whole.body["nextCursor"] != nil {
		t.Fatalf("the default page holds all 6: %d %v", whole.status, whole.body)
	}
	var want []any
	for _, c := range all {
		want = append(want, c.(map[string]any)["clientId"])
	}
	for limit := 1; limit <= 6; limit++ {
		var got []any
		cursor := ""
		for {
			url := fmt.Sprintf("%s?limit=%d", path, limit)
			if cursor != "" {
				url += "&cursor=" + cursor
			}
			r := e.call(t, "GET", url, alice, "", "")
			items, _ := r.body["items"].([]any)
			if r.status != http.StatusOK || len(items) > limit {
				t.Fatalf("limit %d: %d %v", limit, r.status, r.body)
			}
			for _, c := range items {
				got = append(got, c.(map[string]any)["clientId"])
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
	for q, want := range map[string]int{"ALICE": 2, "client5%40": 1, "zo": 1, "de003": 1, "nobody": 0} {
		if items, _ := e.call(t, "GET", path+"?q="+q, alice, "", "").body["items"].([]any); len(items) != want {
			t.Errorf("q=%s: %d clients, want %d", q, len(items), want)
		}
	}
	for query, status := range map[string]int{"limit=0": http.StatusUnprocessableEntity,
		"limit=101": http.StatusUnprocessableEntity, "limit=x": http.StatusBadRequest,
		"cursor=bm90LWEtY3Vyc29y": http.StatusUnprocessableEntity, "q=%20": http.StatusUnprocessableEntity,
		// An id, then a name that isn't UTF-8: refused, never handed to Postgres.
		"cursor=" + base64.RawURLEncoding.EncodeToString([]byte("aaaaaaaa-0000-4000-8000-000000000001|\xff")): http.StatusUnprocessableEntity} {
		if r := e.call(t, "GET", path+"?"+query, alice, "", ""); r.status != status {
			t.Errorf("%s: %d %v, want %d", query, r.status, r.body, status)
		}
	}
}
