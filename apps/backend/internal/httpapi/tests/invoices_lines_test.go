package tests

import (
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

// R-88.
func TestInvoiceLines(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	fixed := func(lines string) string {
		return `{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000", "lines": [` + lines + `]}`
	}
	two := `{"description": "Design", "quantity": "7.5", "unitPrice": "500000"},
		{"description": "Hosting", "quantity": "1", "unitPrice": "1250000"}`
	want := []any{
		map[string]any{"description": "Design", "quantity": "7.50", "unitPrice": "500000", "amount": "3750000"},
		map[string]any{"description": "Hosting", "quantity": "1.00", "unitPrice": "1250000", "amount": "1250000"},
	}
	made := e.post(t, alice, e.aliceProfile, "key-1", fixed(two))
	if made.status != http.StatusCreated || !reflect.DeepEqual(made.body["lines"], want) {
		t.Fatalf("create: %d %v", made.status, made.body["lines"])
	}
	if got := e.get(t, made.body["invoiceId"].(string)); !reflect.DeepEqual(got.body["lines"], want) {
		t.Fatalf("public GET lines %v", got.body["lines"])
	}
	// "7.50" is the same quantity as "7.5"; another description is another request.
	if again := e.post(t, alice, e.aliceProfile, "key-1", fixed(strings.Replace(two, `"7.5"`, `"7.50"`, 1))); again.status != http.StatusOK ||
		again.body["invoiceId"] != made.body["invoiceId"] {
		t.Fatalf("same lines again: %d %v", again.status, again.body)
	}
	if other := e.post(t, alice, e.aliceProfile, "key-1", fixed(strings.Replace(two, "Hosting", "Domain", 1))); other.status != http.StatusConflict {
		t.Fatalf("same key, other line: %d %v", other.status, other.body)
	}
	if plain := e.post(t, alice, e.aliceProfile, "key-2", basicBody); plain.status != http.StatusCreated ||
		!reflect.DeepEqual(plain.body["lines"], []any{}) {
		t.Fatalf("an invoice without lines: %d %v", plain.status, plain.body["lines"])
	}

	// Payer chooses: unit prices are USD and come back in the token's base units.
	usd := e.post(t, alice, e.aliceProfile, "key-3", `{"amountUsd": "12.5", "lines": [
		{"description": "Logo", "quantity": "2", "unitPrice": "6.25"}]}`)
	if usd.status != http.StatusCreated || !reflect.DeepEqual(usd.body["lines"], []any{map[string]any{
		"description": "Logo", "quantity": "2.00", "unitPrice": "6250000", "amount": "12500000"}}) {
		t.Fatalf("payer chooses: %d %v", usd.status, usd.body)
	}

	many := strings.Repeat(`{"description": "x", "quantity": "1", "unitPrice": "0"},`, invoice.MaxLines)
	// The most lines an invoice takes: the last one carries the amount.
	most := e.post(t, alice, e.aliceProfile, "most-lines", fixed(strings.Repeat(`{"description": "x", "quantity": "1", "unitPrice": "0"},`, invoice.MaxLines-1)+
		`{"description": "Design", "quantity": "1", "unitPrice": "5000000"}`))
	if lines, _ := most.body["lines"].([]any); most.status != http.StatusCreated || len(lines) != invoice.MaxLines {
		t.Fatalf("%d lines: %d %v", invoice.MaxLines, most.status, most.body["error"])
	}
	for i, c := range []struct{ name, body string }{
		{"short of the amount", fixed(`{"description": "Design", "quantity": "4", "unitPrice": "1000000"}`)},
		{"one line too many", fixed(many + `{"description": "Design", "quantity": "1", "unitPrice": "5000000"}`)},
		{"no description", fixed(`{"description": "", "quantity": "1", "unitPrice": "5000000"}`)},
		{"description over 200", fixed(`{"description": "` + strings.Repeat("é", 201) + `", "quantity": "1", "unitPrice": "5000000"}`)},
		{"quantity 0", fixed(`{"description": "Design", "quantity": "0", "unitPrice": "5000000"}`)},
		{"quantity with 3 decimals", fixed(`{"description": "Design", "quantity": "1.000", "unitPrice": "5000000"}`)},
		{"quantity over 1000000", fixed(`{"description": "Design", "quantity": "1000001", "unitPrice": "0"}`)},
		{"a decimal unit price with amount", fixed(`{"description": "Design", "quantity": "1", "unitPrice": "5.00"}`)},
		{"half a base unit", fixed(`{"description": "Design", "quantity": "0.5", "unitPrice": "3"},
			{"description": "Rest", "quantity": "1", "unitPrice": "4999998.5"}`)},
		{"a line USDC can't hold", `{"amountUsd": "0.000001", "lines": [
			{"description": "a", "quantity": "1", "unitPrice": "0.0000005"},
			{"description": "b", "quantity": "1", "unitPrice": "0.0000005"}]}`},
	} {
		if r := e.post(t, alice, e.aliceProfile, "bad-"+string(rune('a'+i)), c.body); r.status != http.StatusUnprocessableEntity ||
			errorCode(r) != "invalid_value" {
			t.Fatalf("%s: %d %v, want 422", c.name, r.status, r.body)
		}
	}
}
