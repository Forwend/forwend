package invoice

import (
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
	inv, _, err := s.Create(ctx, profileID, "session", Request{AmountUSD: "12.50", Caller: Caller{Purpose: PurposeCheckout}})
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
	first, _, err := s.Create(ctx, profileID, "first", r)
	if err != nil || first.Number == nil || *first.Number != 1 || first.DocumentKind != DocumentInvoice {
		t.Fatalf("first invoice: %+v, %v", first, err)
	}
}
