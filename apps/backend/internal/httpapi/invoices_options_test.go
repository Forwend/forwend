package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// Payer chooses over HTTP (R-56): amountUsd alone makes one option per enabled token; the invoice shows its first
// option until one has money, lists every option with its own id and address, and an option's id reads the invoice.
func TestPayerChoosesInvoice(t *testing.T) {
	e := invoiceAPI(t)
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO tokens (chain_id, chain_family, contract, symbol,
		decimals, enabled) VALUES (84532, 'evm', '0x3333333333333333333333333333333333333333', 'EURC', 2, true)`); err != nil {
		t.Fatal(err)
	}
	made := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", `{"amountUsd": "12.5"}`)
	if made.status != http.StatusCreated {
		t.Fatalf("create: %d %v", made.status, made.body)
	}
	options, _ := made.body["options"].([]any)
	if len(options) != 2 {
		t.Fatalf("options %v, want USDC and EURC", made.body["options"])
	}
	id := made.body["invoiceId"].(string)
	for i, want := range []struct{ symbol, amount string }{{"EURC", "1250"}, {"USDC", "12500000"}} {
		o := options[i].(map[string]any)
		if o["symbol"] != want.symbol || o["amount"] != want.amount || o["network"] != "base-sepolia" ||
			o["chainId"] != float64(84532) {
			t.Fatalf("option %d: %v, want %s %s", i, o, want.amount, want.symbol)
		}
	}
	first, second := options[0].(map[string]any), options[1].(map[string]any)
	if first["receiveAddress"] == second["receiveAddress"] || first["optionId"] == second["optionId"] {
		t.Fatalf("the options share an id or address: %v", options)
	}
	if made.body["optionId"] != id || first["optionId"] != id || made.body["optionLocked"] != false ||
		made.body["optionCount"] != float64(2) ||
		made.body["receiveAddress"] != first["receiveAddress"] || made.body["amount"] != "1250" {
		t.Fatalf("the invoice shows %v, want its first option", made.body)
	}
	byOption := e.get(t, second["optionId"].(string))
	if byOption.status != http.StatusOK || byOption.body["invoiceId"] != id {
		t.Fatalf("get by option id: %d %v", byOption.status, byOption.body["invoiceId"])
	}

	// Until an option has money, the PDF prices the invoice in USD and leaves the choice to the payer.
	mustContain(t, pdfText(t, e.pdf(t, id, "invoice.pdf", "").body),
		"Payment\nPayer chooses\n2 tokens and networks\n12.50 USD\nTotal\n12.50 USD",
		"then pick the token and network to pay with.")

	// EURC has 2 decimals: a cent fraction can't be paid in it exactly.
	if r := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", `{"amountUsd": "12.505"}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("12.505 USD: %d %v", r.status, r.body)
	}
	if r := e.post(t, "did:privy:alice", e.aliceProfile, "key-3",
		`{"amountUsd": "1", "chainId": 84532, "token": "`+usdc+`", "amount": "1000000"}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("both forms: %d %v", r.status, r.body)
	}
}

// A return link (R-58) is an https link set at creation; the public read gives it to the pay page.
func TestInvoiceReturnURL(t *testing.T) {
	e := invoiceAPI(t)
	made := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", `{"amountUsd": "5", "returnUrl": "https://shop.example/thanks?order=7"}`)
	if made.status != http.StatusCreated {
		t.Fatalf("create: %d %v", made.status, made.body)
	}
	if got := e.get(t, made.body["invoiceId"].(string)).body["returnUrl"]; got != "https://shop.example/thanks?order=7" {
		t.Fatalf("public read returnUrl %v", got)
	}
	if got := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", `{"amountUsd": "5"}`).body["returnUrl"]; got != nil {
		t.Fatalf("no link: returnUrl %v, want null", got)
	}
	for i, bad := range []string{"http://shop.example", "https://", "javascript:alert(1)", "https://user:pass@shop.example",
		"shop.example"} {
		r := e.post(t, "did:privy:alice", e.aliceProfile, fmt.Sprintf("bad-%d", i), `{"amountUsd": "5", "returnUrl": "`+bad+`"}`)
		if r.status != http.StatusUnprocessableEntity || !strings.Contains(fmt.Sprint(r.body), "returnUrl") {
			t.Fatalf("%q: %d %v", bad, r.status, r.body)
		}
	}
}
