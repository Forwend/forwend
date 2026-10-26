package tests

import (
	"context"
	"math/big"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/history/historytest"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

// R-130.
func TestReopenAnInvoiceThatClosedPartlyPaid(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	ctx := context.Background()
	id := e.post(t, alice, e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	// The checkout closed two hours ago, so every reader must take the reopened close, not expiresAt.
	expires := time.Now().Add(-2 * time.Hour).Truncate(time.Second).UTC()
	deadline := expires.Add(7 * 24 * time.Hour)
	e.exec(t, "ALTER TABLE invoices DISABLE TRIGGER invoices_guard, DISABLE TRIGGER invoices_number")
	e.exec(t, "UPDATE invoices SET expires_at = $2, settle_deadline = $3 WHERE id = $1", id, expires.Unix(),
		deadline.Unix())
	e.exec(t, "ALTER TABLE invoices ENABLE TRIGGER invoices_guard, ENABLE TRIGGER invoices_number")
	onChain := new(big.Int)
	deposit := func(block, at, amount int64) {
		onChain.Add(onChain, big.NewInt(amount))
		e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			    block_hash, block_number, block_time, from_address, to_address, amount, status)
			SELECT 84532, 'evm', $1, $2, $3, 0, $3, $4, $5, $6, receive_address, $7, 'confirmed' FROM invoices WHERE id = $2`,
			usdc, id, "0x"+strings.Repeat(string(rune('a'+block)), 64), block, at, aliceWallet, amount)
	}
	// 2 of 5 USDC on time and 2 late, then the chain is final past the close: the ledger expires it partly paid.
	deposit(1, expires.Unix()-60, 2000000)
	deposit(2, expires.Unix()+60, 2000000)
	e.exec(t, `UPDATE chain_cursors SET last_scanned_block = 10, last_finalized_block = 10, last_finalized_time = $1
		WHERE chain_id = 84532`, expires.Unix()+120)
	ledgers := ledger.NewService(e.pool, func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return new(big.Int).Set(onChain), 10, nil
	}, func(context.Context, uint64, string, string) (uint64, error) { return 0, nil })
	if err := ledgers.Process(ctx, id); err != nil {
		t.Fatal(err)
	}
	owned := "/v1/profiles/" + e.aliceProfile + "/invoices/" + id
	closes := expires.Format(time.RFC3339)
	until := deadline.Add(-24 * time.Hour).Format(time.RFC3339)
	if r := e.call(t, "GET", owned, alice, "", ""); r.body["paymentStatus"] != "expired_partially_paid" ||
		r.body["reopenUntil"] != until || r.body["closesAt"] != closes {
		t.Fatalf("closed partly paid: %v, reopenUntil %v, closes %v", r.body["paymentStatus"], r.body["reopenUntil"],
			r.body["closesAt"])
	}

	r := e.call(t, "POST", owned+"/reopen", alice, "", "")
	if r.status != http.StatusOK || r.body["paymentStatus"] != "partially_paid" || r.body["closesAt"] != until ||
		r.body["expiresAt"] != closes || r.body["reopenUntil"] != nil || r.body["closed"] != false {
		t.Fatalf("reopen: %d %v", r.status, r.body)
	}
	mustContain(t, pdfText(t, e.pdf(t, id, "invoice.pdf", "").body),
		"Checkout closes\n"+deadline.Add(-24*time.Hour).Format("2006-01-02 15:04")+" UTC")
	// The late 2 USDC pays now, and 1 more in the new window completes it.
	deposit(3, expires.Unix()+90, 1000000)
	if err := ledgers.Process(ctx, id); err != nil {
		t.Fatal(err)
	}
	paid := e.call(t, "GET", owned, alice, "", "").body
	var got []any
	for _, d := range paid["deposits"].([]any) {
		got = append(got, d.(map[string]any)["paid"], d.(map[string]any)["late"])
	}
	if paid["paymentStatus"] != "paid" || paid["paidAt"] != time.Unix(expires.Unix()+90, 0).UTC().Format(time.RFC3339) ||
		!slices.Equal(got, []any{"2000000", false, "2000000", false, "1000000", false}) {
		t.Fatalf("paid after the reopen: %v, paidAt %v, deposits paid and late %v", paid["paymentStatus"], paid["paidAt"], got)
	}
	activity := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/activity", alice, "", "")
	if !slices.ContainsFunc(activity.body["items"].([]any), func(item any) bool {
		it := item.(map[string]any)
		return it["txHash"] == "0x"+strings.Repeat("c", 64) && it["held"] == false
	}) {
		t.Fatalf("activity doesn't show the late deposit the reopen paid as paid: %v", activity.body["items"])
	}
	if events := historytest.Events(t, e.pool, id); !slices.Contains(events,
		`invoice.reopened by owner {"until": "`+until+`"}`) {
		t.Fatalf("no reopen in the history: %q", events)
	}
	// The exact close, so the page shows it in the reader's time; to is an edited due date's.
	if !slices.ContainsFunc(paid["history"].([]any), func(row any) bool {
		h := row.(map[string]any)
		return h["kind"] == "invoice.reopened" && h["until"] == until && h["to"] == nil
	}) {
		t.Fatalf("the API's reopened row has no until %s: %v", until, paid["history"])
	}
	if public := e.get(t, id).body; public["closesAt"] != until {
		t.Fatalf("the public read closes at %v, want %v", public["closesAt"], until)
	}
	// Once, and only after a partly paid close; another profile's invoice is not found.
	open := e.post(t, alice, e.aliceProfile, "key-2", basicBody).body["invoiceId"].(string)
	for _, path := range []string{owned, "/v1/profiles/" + e.aliceProfile + "/invoices/" + open} {
		if r := e.call(t, "POST", path+"/reopen", alice, "", ""); r.status != http.StatusConflict ||
			errorCode(r) != "invoice_not_reopenable" {
			t.Fatalf("%s: %d %v, want 409", path, r.status, r.body)
		}
	}
	if r := e.call(t, "POST", "/v1/profiles/"+e.walletless+"/invoices/"+id+"/reopen", alice, "", ""); r.status != http.StatusNotFound {
		t.Fatalf("another profile: %d %v, want 404", r.status, r.body)
	}
	if !slices.Contains(historytest.Events(t, e.pool, id), "invoice.expired_partially_paid by system") {
		t.Fatal("the close is not in the history")
	}
}

// R-130: a payer-chooses invoice reopens the option the payer paid with, not its main row. Money on the other option
// after its close stays late.
func TestReopenThePaidOptionOfAPayerChoosesInvoice(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	e.exec(t, `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES (84532, 'evm', '0x3333333333333333333333333333333333333333', 'EURC', 2, true)`)
	made := e.post(t, alice, e.aliceProfile, "key-1", `{"amountUsd": "12.5"}`).body
	id := made["invoiceId"].(string)
	usdcOption := made["options"].([]any)[1].(map[string]any)["optionId"].(string)
	expires := time.Now().Add(-2 * time.Hour).Unix()
	e.exec(t, "ALTER TABLE invoices DISABLE TRIGGER invoices_guard, DISABLE TRIGGER invoices_number")
	e.exec(t, "UPDATE invoices SET expires_at = $2, settle_deadline = $2::bigint + 604800 WHERE coalesce(main_id, id) = $1", id,
		expires)
	e.exec(t, "ALTER TABLE invoices ENABLE TRIGGER invoices_guard, ENABLE TRIGGER invoices_number")
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT 84532, 'evm', $1, $2, $3, 0, $3, 1, $4, $5, receive_address, 2000000, 'confirmed' FROM invoices WHERE id = $2`,
		usdc, usdcOption, "0x"+strings.Repeat("ab", 32), expires-60, aliceWallet)
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT 84532, 'evm', token_contract, id, $2, 0, $2, 2, $3, $4, receive_address, 100, 'confirmed' FROM invoices
		WHERE id = $1`, id, "0x"+strings.Repeat("cd", 32), expires+60, aliceWallet)
	e.exec(t, `UPDATE chain_cursors SET last_scanned_block = 10, last_finalized_block = 10, last_finalized_time = $1
		WHERE chain_id = 84532`, expires+120)
	if err := ledger.NewService(e.pool, func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return big.NewInt(2000000), 10, nil
	}, func(context.Context, uint64, string, string) (uint64, error) {
		return 0, nil
	}).Process(context.Background(), usdcOption); err != nil {
		t.Fatal(err)
	}
	r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id+"/reopen", alice, "", "")
	if r.status != http.StatusOK || r.body["optionId"] != usdcOption || r.body["paymentStatus"] != "partially_paid" {
		t.Fatalf("reopen: %d %v", r.status, r.body)
	}
	other := r.body["options"].([]any)[0].(map[string]any)["deposits"].([]any)
	if len(other) != 1 || other[0].(map[string]any)["late"] != true {
		t.Fatalf("the other option's deposits %v, want one late", other)
	}
}
