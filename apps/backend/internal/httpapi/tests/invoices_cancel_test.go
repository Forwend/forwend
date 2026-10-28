package tests

import (
	"net/http"
	"strings"
	"testing"
)

// R-79, D-79.
func TestCancelInvoice(t *testing.T) {
	e := invoiceAPI(t)
	cancel := func(profile, id string) reply {
		return e.call(t, "POST", "/v1/profiles/"+profile+"/invoices/"+id+"/cancel", "did:privy:alice", "", "")
	}
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	r := cancel(e.aliceProfile, id)
	if r.status != http.StatusOK || r.body["paymentStatus"] != "canceled" || r.body["canceledAt"] == nil {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	if got := e.get(t, id); got.body["paymentStatus"] != "canceled" {
		t.Fatalf("checkout read after cancel: %v", got.body["paymentStatus"])
	}
	if r := cancel(e.aliceProfile, id); r.status != http.StatusConflict || errorCode(r) != "invoice_not_cancelable" {
		t.Fatalf("second cancel: %d %v, want 409", r.status, r.body)
	}
	checkList(t, e, "/v1/profiles/"+e.aliceProfile+"/invoices", func(it map[string]any) any { return it["invoiceId"] },
		[]listCase{{"status=canceled", []any{id}}, {"status=open", []any{}}})

	paid := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", basicBody).body["invoiceId"].(string)
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT 84532, 'evm', $1, $2, $3, 0, $3, 1, 1, $4, receive_address, 1000000, 'detected' FROM invoices WHERE id = $2`,
		usdc, paid, "0x"+strings.Repeat("ab", 32), aliceWallet)
	closed := e.post(t, "did:privy:alice", e.aliceProfile, "key-3", basicBody).body["invoiceId"].(string)
	e.closeCheckout(t, closed)
	for _, id := range []string{paid, closed} {
		if r := cancel(e.aliceProfile, id); r.status != http.StatusConflict || errorCode(r) != "invoice_not_cancelable" {
			t.Fatalf("%s: %d %v, want 409", id, r.status, r.body)
		}
	}

	// The fixture's other profile has no wallet to invoice with, so an invoice moves there under a lifted guard.
	other := e.post(t, "did:privy:alice", e.aliceProfile, "key-4", basicBody).body["invoiceId"].(string)
	e.exec(t, `ALTER TABLE invoices DISABLE TRIGGER invoices_guard`)
	e.exec(t, `UPDATE invoices SET profile_id = $2 WHERE id = $1`, other, e.walletless)
	e.exec(t, `ALTER TABLE invoices ENABLE TRIGGER invoices_guard`)
	if r := cancel(e.aliceProfile, other); r.status != http.StatusNotFound {
		t.Fatalf("another profile's invoice: %d %v, want 404", r.status, r.body)
	}
	if got := e.get(t, other); got.body["paymentStatus"] != "open" {
		t.Fatalf("another profile's invoice after a refused cancel: %v, want open", got.body["paymentStatus"])
	}
	if r := cancel(e.bobProfile, id); r.status != http.StatusForbidden {
		t.Fatalf("Bob's profile: %d %v, want 403", r.status, r.body)
	}
	if r := cancel(e.aliceProfile, "0x"+strings.Repeat("0", 64)); r.status != http.StatusNotFound {
		t.Fatalf("unknown invoice: %d %v, want 404", r.status, r.body)
	}
}

func TestCancelPayerChoosesInvoice(t *testing.T) {
	e := invoiceAPI(t)
	e.exec(t, `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES (84532, 'evm', '0x3333333333333333333333333333333333333333', 'EURC', 2, true)`)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", `{"amountUsd": "12.5"}`).body["invoiceId"].(string)
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id+"/cancel", "did:privy:alice", "", ""); r.status != http.StatusOK {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	var open, canceled int
	if err := e.pool.QueryRow(t.Context(), `SELECT count(*) FILTER (WHERE payment_status = 'open'),
		count(*) FILTER (WHERE payment_status = 'canceled') FROM invoices WHERE coalesce(main_id, id) = $1`, id).Scan(&open, &canceled); err != nil {
		t.Fatal(err)
	}
	if open != 0 || canceled != 2 {
		t.Fatalf("rows open %d, canceled %d; want 0 open and every option canceled", open, canceled)
	}

	// Money on any option, not only the shown one, is too late to cancel.
	paid := e.post(t, "did:privy:alice", e.aliceProfile, "key-2", `{"amountUsd": "12.5"}`).body["invoiceId"].(string)
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT chain_id, 'evm', token_contract, id, $2, 0, $2, 1, 1, $3, receive_address, 100, 'detected'
		FROM invoices WHERE main_id = $1`, paid, "0x"+strings.Repeat("cd", 32), aliceWallet)
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+paid+"/cancel", "did:privy:alice", "", ""); r.status != http.StatusConflict {
		t.Fatalf("money on a second option: %d %v, want 409", r.status, r.body)
	}
}

// D-79.
func TestCanceledInvoicePDF(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1",
		strings.Replace(basicBody, "{", `{"supplyDate": "2026-10-01", "reference": "PO-7",
		"agreedValue": {"currency": "GBP", "amount": "4", "date": "2026-10-01"}, `, 1)).body["invoiceId"].(string)
	before := e.pdf(t, id, "invoice.pdf", "")
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id+"/cancel", "did:privy:alice", "", ""); r.status != http.StatusOK {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	r := e.pdf(t, id, "invoice.pdf", before.header.Get("ETag"))
	if r.status != http.StatusOK {
		t.Fatalf("a canceled invoice's PDF must not answer 304 for the payable one: %d", r.status)
	}
	text := pdfText(t, r.body)
	mustContain(t, text, "Forwend\nInvoice\nINV-0001\nReference PO-7\nTESTNET\nTest mode: testnet tokens have no value\nCanceled\n",
		"Do not send money.", "Supply date\n2026-10-01\nCanceled", "Total\n5.00 USDC\nAgreed value 4.00 GBP on 2026-10-01")
	if qrDrawn(t, r.body) {
		t.Fatalf("the canceled PDF still has a QR code")
	}
	for _, gone := range []string{"Pay this invoice", "/pay/", "Amount due", "Payment window"} {
		if strings.Contains(text, gone) {
			t.Fatalf("canceled PDF still says %q:\n%s", gone, text)
		}
	}
	if r := e.pdf(t, id, "receipt.pdf", ""); r.status != http.StatusConflict {
		t.Fatalf("receipt of a canceled invoice: %d, want 409", r.status)
	}
}
