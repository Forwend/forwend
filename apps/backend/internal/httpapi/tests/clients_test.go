package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

const (
	clientA = "11111111-1111-4111-8111-111111111111"
	clientB = "22222222-2222-4222-8222-222222222222"
)

// R-86: a profile saves clients by an id it picks, lists them by name, edits and deletes them; only its owner can, and
// an invoice made from a client keeps its copy.
func TestClients(t *testing.T) {
	e := invoiceAPI(t)
	const alice, bob = "did:privy:alice", "did:privy:bob"
	path := "/v1/profiles/" + e.aliceProfile + "/clients"
	list := func(user string) reply { return e.call(t, "GET", path, user, "", "") }
	clients := func(r reply) []any { c, _ := r.body["clients"].([]any); return c }

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
		"address": "Main St 1\nBerlin", "country": "DE", "taxId": "DE999999999", "reference": "PO-4500012345"}
	if !reflect.DeepEqual(made.body, want) {
		t.Fatalf("PUT returned %v, want %v", made.body, want)
	}
	// The same request again is the same client: a retried save never makes two.
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

	// An invoice copies the client's details; editing and deleting the client leave it as it was.
	invoice := e.post(t, alice, e.aliceProfile, "key-1", `{"chainId": 84532, "token": "`+usdc+`", "amount": "1",
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

	// Only the owner reads or writes the profile's clients, and another profile's client id is not found.
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

	// Each case changes one field of a valid body.
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

	// A profile keeps at most 1000 clients; editing one still works when full. Concurrent saves:
	// TestSaveClientCapCountsASaveInFlight.
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
