package job

import (
	"context"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
)

// R-104: record times come from the server; PaidAt is the completing deposit's block time.
func TestRecordTimes(t *testing.T) {
	ctx := context.Background()
	pool, profileID := open(t)
	invoices := invoice.NewService(pool)
	s := NewService(pool, invoices)
	j, _, err := s.Create(ctx, profileID, "k1", quote(true))
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := s.Accept(ctx, j.Token, "Jane Doe", "jane@bob.example", noLimit)
	if err != nil {
		t.Fatal(err)
	}
	deposit := accepted.Payments[0]
	inv, err := invoices.GetOfProfile(ctx, profileID, deposit.InvoiceID)
	if err != nil {
		t.Fatal(err)
	}
	if !deposit.InvoicedAt.Equal(inv.CreatedAt.UTC()) || !deposit.PaidAt.IsZero() || !accepted.Payments[1].InvoicedAt.IsZero() {
		t.Fatalf("before payment: invoiced %v (invoice %v), paid %v", deposit.InvoicedAt, inv.CreatedAt, deposit.PaidAt)
	}

	paidAt := time.Now().UTC().Truncate(time.Second).Add(-time.Minute)
	if _, err := pool.Exec(ctx, `UPDATE chain_cursors SET last_scanned_block = 100, last_finalized_block = 100,
		last_finalized_time = $1 WHERE chain_id = 84532`, paidAt.Unix()); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id,
		tx_hash, log_index, block_hash, block_number, block_time, from_address, to_address, amount, status)
		VALUES (84532, 'evm', $1, $2, $3, 0, $3, 90, $4, $5, $5, $6, 'confirmed')`,
		inv.Token, inv.OptionID, "0x"+strings.Repeat("01", 32), paidAt.Unix(), inv.ReceiveAddress, inv.Amount.String()); err != nil {
		t.Fatal(err)
	}
	balances := func(context.Context, uint64, string, string) (*big.Int, uint64, error) { return inv.Amount, 100, nil }
	notDeployed := func(context.Context, uint64, string, string) (uint64, error) { return 0, nil }
	if err := ledger.NewService(pool, balances, notDeployed).Process(ctx, inv.OptionID); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, profileID, j.ID)
	if err != nil {
		t.Fatal(err)
	}
	if p := got.Payments[0]; p.Status != "paid" || !p.PaidAt.Equal(paidAt) {
		t.Fatalf("after payment: status %q paid %v, want paid at %v", p.Status, p.PaidAt, paidAt)
	}
}
