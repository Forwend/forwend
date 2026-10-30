package tests

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// R-56.
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
	// Activity says the client chooses, so it reads in USD rather than the first option's token (R-70).
	activity := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/activity", "did:privy:alice", "", "")
	items, _ := activity.body["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["optionCount"] != float64(2) {
		t.Fatalf("activity %d %v, want the invoice with optionCount 2", activity.status, activity.body)
	}
	// An option's id goes on chain when it settles, so it opens nothing public (D-86).
	if byOption := e.get(t, second["optionId"].(string)); byOption.status != http.StatusNotFound {
		t.Fatalf("get by option id: %d %v", byOption.status, byOption.body)
	}

	mustContain(t, pdfText(t, e.pdf(t, id, "invoice.pdf", "").body),
		"Payment\n12.50 USD\nTotal\n12.50 USD\nPay this invoice\nPay 12.50 USD in one of the available options.\n"+
			"Scan the code or open the link, then pick the token and network.")

	// EURC has 2 decimals: a cent fraction can't be paid in it exactly.
	if r := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", `{"amountUsd": "12.505"}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("12.505 USD: %d %v", r.status, r.body)
	}
	if r := e.post(t, "did:privy:alice", e.aliceProfile, "key-3",
		`{"amountUsd": "1", "chainId": 84532, "token": "`+usdc+`", "amount": "1000000"}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("both forms: %d %v", r.status, r.body)
	}
}

// R-58.
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
