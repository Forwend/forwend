package tests

import (
	"net/http"
	"regexp"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// D-86: the chain shows an invoice's id and its options' ids (ReceiverDeployed, Settled, the deploy calldata), so
// none of them opens a public route; only the pay link's token does, and the id is keccak256 of it.
func TestPublicRoutesTakeOnlyThePayToken(t *testing.T) {
	e := invoiceAPI(t)
	e.exec(t, `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES (84532, 'evm', '0x3333333333333333333333333333333333333333', 'EURC', 2, true)`)
	made := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", `{"amountUsd": "12.5"}`)
	id, _ := made.body["invoiceId"].(string)
	token, _ := made.body["payToken"].(string)
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(token) ||
		crypto.Keccak256Hash(common.FromHex(token)).Hex() != id {
		t.Fatalf("invoiceId %q is not keccak256 of payToken %q", id, token)
	}
	option := made.body["options"].([]any)[1].(map[string]any)["optionId"].(string)
	public := func(method, path, body string) int {
		return e.call(t, method, "/v1/invoices/"+path, "", "", body).status
	}
	for _, onChain := range []string{id, option, strings.TrimPrefix(id, "0x")} {
		for _, r := range []struct{ method, path, body string }{{"GET", onChain, ""}, {"GET", onChain + "/invoice.pdf", ""},
			{"GET", onChain + "/receipt.pdf", ""}, {"POST", onChain + "/recheck", ""},
			{"PUT", onChain + "/payer-email", `{"email": "a@example.com"}`}} {
			if got := public(r.method, r.path, r.body); got != http.StatusNotFound {
				t.Errorf("%s %s: %d, want 404", r.method, r.path, got)
			}
		}
	}
	if r := e.call(t, "GET", "/v1/invoices/"+token, "", "", ""); r.status != http.StatusOK || r.body["invoiceId"] != id ||
		r.body["payToken"] != token {
		t.Fatalf("by the token: %d %v", r.status, r.body)
	}
	if got := public("PUT", token+"/payer-email", `{"email": "a@example.com"}`); got != http.StatusOK {
		t.Fatalf("payer email by the token: %d", got)
	}

	// An invoice made before D-86 has no token: its id, random, opens nothing public, like every id, and the owner's
	// read has no pay link.
	old := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", basicBody).body["invoiceId"].(string)
	e.exec(t, "UPDATE invoices SET pay_token = NULL WHERE id = $1", old)
	if got := public("GET", old, ""); got != http.StatusNotFound {
		t.Fatalf("an old invoice by its id: %d, want 404", got)
	}
	owned := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+old, "did:privy:alice", "", "")
	if pay, ok := owned.body["payToken"]; owned.status != http.StatusOK || !ok || pay != nil {
		t.Fatalf("owner's read of an old invoice: %d payToken %v", owned.status, owned.body["payToken"])
	}
}
