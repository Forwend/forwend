package invoice

import (
	"context"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
)

// R-130: reopening needs ReopenMargin before the settle deadline and no refund under way; the reopened close is that
// margin before the deadline.
func TestReopenNeedsADayBeforeTheSettleDeadline(t *testing.T) {
	pool, profile := open(t)
	ctx := context.Background()
	s := NewService(pool)
	inv, _, err := s.Create(ctx, profile, "key-1", Request{ChainID: 84532, Token: usdc, Amount: "5000000"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash,
		    log_index, block_hash, block_number, block_time, from_address, to_address, amount, status)
		VALUES (84532, 'evm', $1, $2, $3, 0, $3, 1, $4, '0x00000000000000000000000000000000000000ff', $5, 2000000, 'confirmed')`,
		usdc, inv.ID, "0x"+strings.Repeat("ab", 32), inv.ExpiresAt.Unix()-60, inv.ReceiveAddress); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chain_cursors SET last_scanned_block = 10, last_finalized_block = 10,
		last_finalized_time = $1`, inv.ExpiresAt.Unix()+60); err != nil {
		t.Fatal(err)
	}
	if err := ledger.NewService(pool, func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return big.NewInt(2000000), 10, nil
	}).Process(ctx, inv.ID); err != nil {
		t.Fatal(err)
	}
	until := inv.SettleDeadline.Add(-ReopenMargin)
	s.now = func() time.Time { return until }
	if _, err := s.Reopen(ctx, profile, inv.ID); !errors.Is(err, ErrNotReopenable) {
		t.Fatalf("at the last moment: %v, want ErrNotReopenable", err)
	}
	s.now = func() time.Time { return until.Add(-time.Second) }
	refund := func(status string) {
		if _, err := pool.Exec(ctx, "UPDATE invoices SET refund_status = $2 WHERE id = $1", inv.ID, status); err != nil {
			t.Fatal(err)
		}
	}
	refund("refund_pending")
	if _, err := s.Reopen(ctx, profile, inv.ID); !errors.Is(err, ErrNotReopenable) {
		t.Fatalf("while refunding: %v, want ErrNotReopenable", err)
	}
	refund("held")
	reopened, err := s.Reopen(ctx, profile, inv.ID)
	if err != nil || !reopened.ClosesAt.Equal(until) || reopened.PaymentStatus != ledger.PartiallyPaid {
		t.Fatalf("a second before: %v, closes %v, %s", err, reopened.ClosesAt, reopened.PaymentStatus)
	}
}
