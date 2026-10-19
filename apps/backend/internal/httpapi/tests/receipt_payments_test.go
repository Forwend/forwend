package tests

import (
	"context"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
)

// R-121: the receipt lists only what was paid to the creator. A deposit after the invoice was already paid is held
// for the payer (D-26), and only the paid part of a deposit that went over counts (audit 2026-10-19).
func TestReceiptListsOnlyMoneyPaidToTheCreator(t *testing.T) {
	e := invoiceAPI(t)
	ctx := context.Background()
	made := e.post(t, "did:privy:alice", e.aliceProfile, "key-1",
		`{"chainId": 84532, "token": "`+usdc+`", "amount": "2000000"}`).body
	id, receive := made["invoiceId"].(string), made["receiveAddress"].(string)
	expires, _ := time.Parse(time.RFC3339, made["expiresAt"].(string))
	at := time.Unix(expires.Unix()-100, 0).UTC() // before the checkout closes
	e.exec(t, `UPDATE chain_cursors SET last_scanned_block = 100, last_finalized_block = 100,
		last_finalized_time = $1 WHERE chain_id = 84532`, at.Unix())
	deposit := func(hash string, block, amount int64, when time.Time) {
		t.Helper()
		e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			block_hash, block_number, block_time, from_address, to_address, amount, status)
			VALUES (84532, 'evm', $1, $2, $3, 0, $3, $4, $5, $6, $6, $7, 'confirmed')`,
			usdc, id, hash, block, when.Unix(), receive, amount)
		balances := func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
			return big.NewInt(5500000), 100, nil
		}
		if err := ledger.NewService(e.pool, balances).Process(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	// 1.5 USDC, then 1.5 of which 0.5 completes the amount and 1 is held, then 2.5 more, all held.
	first, second, third := "0x"+strings.Repeat("01", 32), "0x"+strings.Repeat("02", 32), "0x"+strings.Repeat("03", 32)
	deposit(first, 90, 1500000, at.Add(-2*time.Minute))
	deposit(second, 91, 1500000, at.Add(-time.Minute))
	deposit(third, 95, 2500000, at)

	r := e.pdf(t, id, "receipt.pdf", "")
	if r.status != http.StatusOK {
		t.Fatalf("receipt: %d %s", r.status, r.body)
	}
	text := pdfText(t, r.body)
	payments := text[strings.Index(text, "PAYMENTS"):]
	if !strings.Contains(payments, "1.50 USDC") || !strings.Contains(payments, "0.50 USDC") ||
		strings.Contains(payments, third) || strings.Contains(payments, "2.50 USDC") {
		t.Fatalf("receipt payments:\n%s\nwant 1.50 and 0.50 USDC, not the held deposit", payments)
	}
	// The pay page reads the same split.
	paid := map[string]any{}
	for _, d := range e.get(t, id).body["deposits"].([]any) {
		paid[d.(map[string]any)["txHash"].(string)] = d.(map[string]any)["paid"]
	}
	if paid[first] != "1500000" || paid[second] != "500000" || paid[third] != "0" {
		t.Fatalf("deposits paid %v, want 1500000, 500000 and 0", paid)
	}
}
