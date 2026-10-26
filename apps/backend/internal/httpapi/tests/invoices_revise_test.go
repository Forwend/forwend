package tests

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/history/historytest"
)

// R-129.
func TestReviseReplacesTheInvoice(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	old := e.post(t, alice, e.aliceProfile, "key-1", basicBody).body
	oldID := old["invoiceId"].(string)
	revise := func(key, id string) reply {
		return e.post(t, alice, e.aliceProfile, key, `{"chainId": 84532, "token": "`+usdc+`", "amount": "6000000",
			"replaces": "`+id+`"}`)
	}
	r := revise("key-2", oldID)
	if r.status != http.StatusCreated || r.body["number"] != old["number"].(float64)+1 {
		t.Fatalf("revise: %d %v", r.status, r.body)
	}
	newID, token := r.body["invoiceId"].(string), r.body["payToken"].(string)
	if replaces := r.body["replaces"].(map[string]any); replaces["invoiceId"] != oldID || replaces["payToken"] != nil {
		t.Fatalf("the new invoice replaces %v", replaces)
	}
	owner := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+oldID, alice, "", "").body
	public := e.get(t, oldID).body
	for _, read := range []map[string]any{owner, public} {
		by := read["replacedBy"].(map[string]any)
		if read["paymentStatus"] != "canceled" || by["invoiceId"] != newID || by["payToken"] != token ||
			by["number"] != r.body["number"] {
			t.Fatalf("the old invoice: %v replaced by %v", read["paymentStatus"], by)
		}
	}
	number := func(n any) string { return fmt.Sprint(int64(n.(float64))) }
	if got, want := historytest.Events(t, e.pool, oldID), []string{"invoice.created by owner",
		`invoice.replaced by owner {"number": ` + number(r.body["number"]) + `, "invoice": "` + newID + `"}`}; !slices.Equal(got, want) {
		t.Fatalf("old history %q, want %q", got, want)
	}
	if got, want := historytest.Events(t, e.pool, newID), []string{
		`invoice.created by owner {"number": ` + number(old["number"]) + `, "invoice": "` + oldID + `"}`}; !slices.Equal(got, want) {
		t.Fatalf("new history %q, want %q", got, want)
	}
	if again := revise("key-2", oldID); again.status != http.StatusOK || again.body["invoiceId"] != newID {
		t.Fatalf("the same key again: %d %v", again.status, again.body)
	}

	// Money seen: nothing is made, and the invoice stays as it is.
	paid := e.post(t, alice, e.aliceProfile, "key-3", basicBody).body["invoiceId"].(string)
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT 84532, 'evm', $1, $2, $3, 0, $3, 1, 1, $4, receive_address, 1000000, 'detected' FROM invoices WHERE id = $2`,
		usdc, paid, "0x"+strings.Repeat("ab", 32), aliceWallet)
	var before int
	if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM invoices").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if r := revise("key-4", paid); r.status != http.StatusConflict || errorCode(r) != "invoice_not_cancelable" {
		t.Fatalf("after money: %d %v, want 409", r.status, r.body)
	}
	var after int
	if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM invoices").Scan(&after); err != nil || after != before {
		t.Fatalf("invoices %d after a refused revise, want %d (%v)", after, before, err)
	}
	if r := revise("key-5", "0x"+strings.Repeat("0", 64)); r.status != http.StatusNotFound {
		t.Fatalf("an unknown invoice: %d %v, want 404", r.status, r.body)
	}

	// Another user's invoice, and the same user's other profile's: not found, and left open.
	e.exec(t, `INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		VALUES ($1, 'privy', 'bob-wallet', 'evm', '0x3333333333333333333333333333333333333333')`, e.bobProfile)
	bobs := e.post(t, "did:privy:bob", e.bobProfile, "key-1", basicBody).body["invoiceId"].(string)
	other := e.post(t, alice, e.aliceProfile, "key-6", basicBody).body["invoiceId"].(string)
	e.exec(t, `ALTER TABLE invoices DISABLE TRIGGER invoices_guard`)
	e.exec(t, `UPDATE invoices SET profile_id = $2 WHERE id = $1`, other, e.walletless)
	e.exec(t, `ALTER TABLE invoices ENABLE TRIGGER invoices_guard`)
	for i, id := range []string{bobs, other} {
		if r := revise(fmt.Sprint("key-7-", i), id); r.status != http.StatusNotFound || errorCode(r) != "invoice_not_found" {
			t.Fatalf("%s: %d %v, want 404", id, r.status, r.body)
		}
		if got := e.get(t, id).body["paymentStatus"]; got != "open" {
			t.Fatalf("%s after a refused revise: %v, want open", id, got)
		}
	}
}
