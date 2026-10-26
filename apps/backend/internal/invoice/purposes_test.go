package invoice

import (
	"bytes"
	"math/big"
	"testing"
)

func TestCheckoutOptionsSharePurposeAndNeverConsumeInvoiceNumbers(t *testing.T) {
	pool, profileID := open(t)
	ctx := t.Context()
	if _, err := pool.Exec(ctx, `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES (84532, 'evm', '0x' || repeat('ab', 20), 'OTHER', 18, true)`); err != nil {
		t.Fatal(err)
	}
	s := NewService(pool)
	inv, _, err := s.Create(ctx, profileID, "session", Request{Purpose: PurposeCheckout, AmountUSD: "12.50"})
	if err != nil {
		t.Fatal(err)
	}
	var count, aligned int
	if err := pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE purpose = 'checkout'
		AND document_kind = 'none' AND number IS NULL) FROM invoices WHERE coalesce(main_id, id) = $1`, inv.ID).
		Scan(&count, &aligned); err != nil || count != 2 || aligned != 2 {
		t.Fatalf("checkout options: %d total, %d aligned, %v", count, aligned, err)
	}
	r := Request{ChainID: 84532, Token: usdc, Amount: "5000000"}
	legacy, _, err := s.Create(ctx, profileID, "legacy", r)
	if err != nil || legacy.Number == nil || *legacy.Number != 1 || legacy.DocumentKind != DocumentInvoice {
		t.Fatalf("legacy invoice: %+v, %v", legacy, err)
	}
	var stored []byte
	if err := pool.QueryRow(ctx, "SELECT request_hash FROM invoices WHERE id = $1", legacy.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	want := requestHash(84532, usdc, big.NewInt(5000000), DefaultExpiresIn, Details{}, nil, false, nil, "", "")
	if !bytes.Equal(stored, want) {
		t.Fatal("legacy request fingerprint changed")
	}
	if replay, created, err := s.Create(ctx, profileID, "legacy", r); err != nil || created || replay.ID != legacy.ID {
		t.Fatalf("legacy replay: %+v, created %v, %v", replay, created, err)
	}
}
