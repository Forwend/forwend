package invoice

import (
	"context"
	"encoding/hex"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/address"
)

func mustHexID(t *testing.T, id string) []byte {
	t.Helper()
	b, err := hex.DecodeString(id[2:])
	if err != nil || len(b) != 32 {
		t.Fatalf("id %q", id)
	}
	return b
}

func TestCreatePayerChooses(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	// Tempo is enabled but not scanned yet.
	if _, err := pool.Exec(ctx, `
		UPDATE chains SET enabled = true WHERE chain_id IN (421614, 42431);
		UPDATE tokens SET enabled = true WHERE chain_id IN (421614, 42431);
		INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES (421614, 0, 0)`); err != nil {
		t.Fatal(err)
	}
	s := NewService(pool)
	inv, created, err := s.Create(ctx, profile, "key-1", Request{AmountUSD: "12.5", Details: Details{Title: "Logo"}})
	if err != nil || !created {
		t.Fatalf("create: %v, created %v", err, created)
	}
	if len(inv.Options) != 2 || inv.Options[0].ChainID != 84532 || inv.Options[1].ChainID != 421614 {
		t.Fatalf("options %+v, want Base Sepolia then Arbitrum Sepolia", inv.Options)
	}
	for _, o := range inv.Options {
		var id [32]byte
		_, _ = hex.Decode(id[:], []byte(o.ID[2:]))
		want, err := receiveAddress(id, o.ChainID, o.Token, inv.Recipient, o.Amount, o.Fees.Network, o.Fees.Platform, inv.ExpiresAt,
			inv.SettleDeadline)
		if err != nil || o.ReceiveAddress != want || o.Amount.String() != "12500000" || o.Symbol != "USDC" {
			t.Fatalf("option %+v: want address %s and 12500000 USDC (%v)", o, want, err)
		}
	}
	if main := [32]byte(mustHexID(t, inv.ID)); inv.Options[1].ID != hexID(address.OptionID(main, 421614,
		hex20(inv.Options[1].Token))) {
		t.Fatalf("option id %s does not derive from %s", inv.Options[1].ID, inv.ID)
	}
	if byOption, err := s.GetOfProfile(ctx, profile, inv.Options[1].ID); err != nil || byOption.ID != inv.ID {
		t.Fatalf("get by option: %s, %v", byOption.ID, err)
	}
	if _, err := pool.Exec(ctx, "DELETE FROM chain_cursors"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Create(ctx, profile, "key-3", Request{AmountUSD: "1"}); !errors.Is(err, ErrNotWatched) {
		t.Fatalf("no chain watched: err = %v, want ErrNotWatched", err)
	}
}

func TestRecheckWithOneNetworkDown(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	if _, err := pool.Exec(ctx, `
		UPDATE chains SET enabled = true WHERE chain_id = 421614;
		UPDATE tokens SET enabled = true WHERE chain_id = 421614;
		INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES (421614, 0, 0)`); err != nil {
		t.Fatal(err)
	}
	s := NewService(pool)
	inv, _, err := s.Create(ctx, profile, "key-1", Request{AmountUSD: "1"})
	if err != nil || len(inv.Options) != 2 {
		t.Fatalf("create: %v, %d options", err, len(inv.Options))
	}
	down := map[uint64]bool{421614: true}
	balanceOf := func(_ context.Context, chainID uint64, _, _ string) (*big.Int, uint64, error) {
		if down[chainID] {
			return nil, 0, errors.New("no answer")
		}
		return big.NewInt(0), 1, nil
	}
	r, err := s.Recheck(ctx, inv.PayToken, balanceOf, noLimit)
	if err != nil || r.OnChain.Sign() != 0 || len(r.Unreadable) != 1 || r.Unreadable[0] != 421614 {
		t.Fatalf("one down: %+v, %v", r, err)
	}
	if _, err := pool.Exec(ctx, "UPDATE invoice_rechecks SET checked_at = now() - interval '10 minutes'"); err != nil {
		t.Fatal(err)
	}
	again := func() {
		t.Helper()
		if _, err := pool.Exec(ctx, "UPDATE invoice_rechecks SET checked_at = now() - interval '10 minutes'"); err != nil {
			t.Fatal(err)
		}
	}
	down = map[uint64]bool{84532: true}
	if _, err := s.Recheck(ctx, inv.PayToken, balanceOf, noLimit); !errors.Is(err, ErrChainUnavailable) {
		t.Fatalf("shown option down: err = %v, want ErrChainUnavailable", err)
	}
	again()
	money := func(_ context.Context, chainID uint64, _, _ string) (*big.Int, uint64, error) {
		if chainID == 84532 {
			return nil, 0, errors.New("no answer")
		}
		return big.NewInt(1000000), 1, nil
	}
	r, err = s.Recheck(ctx, inv.PayToken, money, noLimit)
	if err != nil || r.OnChain.Int64() != 1000000 || !r.Rescanning || len(r.Unreadable) != 1 || r.Unreadable[0] != 84532 {
		t.Fatalf("money on the other option: %+v, %v", r, err)
	}
	again()
	down = map[uint64]bool{84532: true, 421614: true}
	if _, err := s.Recheck(ctx, inv.PayToken, balanceOf, noLimit); !errors.Is(err, ErrChainUnavailable) {
		t.Fatalf("all down: err = %v, want ErrChainUnavailable", err)
	}
}

func noLimit(string) time.Duration { return 0 }

func TestClosedCountsEveryOptionBeforeTheChoice(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`UPDATE chains SET enabled = true WHERE chain_id = 421614`)
	exec(`UPDATE tokens SET enabled = true WHERE chain_id = 421614`)
	exec(`INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES (421614, 0, 0)`)
	inv, _, err := NewService(pool).Create(ctx, profile, "key-1", Request{AmountUSD: "12.5"})
	if err != nil || len(inv.Options) != 2 {
		t.Fatalf("create: %v, %d options", err, len(inv.Options))
	}
	exec(`ALTER TABLE invoices DISABLE TRIGGER USER`)
	exec(`UPDATE invoices SET expires_at = extract(epoch FROM now())::bigint - 60 WHERE id = $1 OR main_id = $1`, inv.ID)
	exec(`ALTER TABLE invoices ENABLE TRIGGER USER`)
	closed := func() bool {
		t.Helper()
		var c bool
		if err := pool.QueryRow(ctx, "SELECT "+ClosedSQL+" FROM "+invoicesCurrent+" WHERE id = $1", inv.ID).Scan(&c); err != nil {
			t.Fatal(err)
		}
		return c
	}
	if !closed() {
		t.Fatal("nothing paid: open, want closed")
	}
	exec(`INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index, block_hash,
		    block_number, block_time, from_address, to_address, amount, status)
		SELECT chain_id, 'evm', token_contract, id, '0x' || repeat('ab', 32), 0, '0x' || repeat('ab', 32), 1,
		    expires_at - 10, '0x' || repeat('ff', 20), receive_address, amount, 'confirmed' FROM invoices WHERE id = $1`,
		inv.Options[1].ID)
	if closed() {
		t.Fatal("paid in full on time on the other option, before the choice: closed, want open")
	}
	exec(`UPDATE invoices SET chosen_id = id WHERE id = $1`, inv.ID)
	if !closed() {
		t.Fatal("the unpaid main row chosen: open, want closed")
	}
}
