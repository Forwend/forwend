package tests

import (
	"net/http"
	"strings"
	"testing"
)

// R-57: the payer's pick opens the pay link on that option again, until money is seen.
func TestPayerPickIsKeptUntilMoneyIsSeen(t *testing.T) {
	e := invoiceAPI(t)
	e.exec(t, `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES (84532, 'evm', '0x3333333333333333333333333333333333333333', 'EURC', 2, true)`)
	made := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", `{"amountUsd": "12.5"}`)
	id := made.body["invoiceId"].(string)
	second := made.body["options"].([]any)[1].(map[string]any)["optionId"].(string)
	pick := func(token, option string) reply {
		return e.call(t, "PUT", "/v1/invoices/"+token+"/pick", "", "", `{"optionId": "`+option+`"}`)
	}
	if got := e.get(t, id); got.body["pickedOptionId"] != nil {
		t.Fatalf("before a pick: %v, want null", got.body["pickedOptionId"])
	}
	if r := pick(e.link(t, id), second); r.status != http.StatusNoContent {
		t.Fatalf("pick: %d %v", r.status, r.body)
	}
	if got := e.get(t, id); got.body["pickedOptionId"] != second || got.body["optionId"] != id {
		t.Fatalf("after a pick: picked %v, option %v; want the pick shown and the terms unchanged",
			got.body["pickedOptionId"], got.body["optionId"])
	}
	// The same pick again changes nothing, so the owner's history holds it once.
	if r := pick(e.link(t, id), second); r.status != http.StatusNoContent {
		t.Fatalf("same pick: %d %v", r.status, r.body)
	}
	owner := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id, "did:privy:alice", "", "")
	picks := 0
	for _, row := range owner.body["history"].([]any) {
		if row.(map[string]any)["kind"] == "payer.option_picked" {
			picks++
		}
	}
	if picks != 1 {
		t.Fatalf("history has %d picks, want 1: %v", picks, owner.body["history"])
	}
	other := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", basicBody).body["invoiceId"].(string)
	if r := pick(e.link(t, id), other); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("another invoice's id: %d %v, want 422", r.status, r.body)
	}
	// A Fixed invoice has nothing to pick.
	if r := pick(e.link(t, other), other); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("a Fixed invoice: %d %v, want 422", r.status, r.body)
	}
	if r := pick("0x"+strings.Repeat("0", 64), second); r.status != http.StatusNotFound {
		t.Fatalf("unknown link: %d, want 404", r.status)
	}

	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT 84532, 'evm', token_contract, id, $2, 0, $2, 1, 1, $3, receive_address, 1000000, 'detected'
		FROM invoices WHERE id = $1`, id, "0x"+strings.Repeat("ab", 32), aliceWallet)
	if r := pick(e.link(t, id), id); r.status != http.StatusConflict || errorCode(r) != "pick_locked" {
		t.Fatalf("after money: %d %v, want 409 pick_locked", r.status, r.body)
	}
	if got := e.get(t, id); got.body["pickedOptionId"] != second {
		t.Fatalf("after a refused pick: %v, want %s", got.body["pickedOptionId"], second)
	}
}
