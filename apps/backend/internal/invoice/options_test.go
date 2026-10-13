package invoice

import (
	"context"
	"encoding/hex"
	"errors"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/search"
)

// Payer chooses (R-56, D-75, D-76): one option per enabled token on a watched chain, each with the USD amount in its
// own decimals and its own on-chain id and receive address computed from its own terms.
func TestCreatePayerChooses(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	// Arbitrum Sepolia USDC is watched; Tempo is enabled but not scanned yet, so it can't take money.
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
	if inv.ID != inv.Options[0].ID || inv.OptionID != inv.ID || inv.OptionLocked || inv.Number != 1 || inv.Title != "Logo" {
		t.Fatalf("invoice %s option %s locked %v number %d title %q", inv.ID, inv.OptionID, inv.OptionLocked, inv.Number,
			inv.Title)
	}
	for _, o := range inv.Options {
		var id [32]byte
		_, _ = hex.Decode(id[:], []byte(o.ID[2:]))
		_, want, err := buildTerms(id, o.ChainID, o.Token, inv.Recipient, o.Amount, inv.ExpiresAt, inv.SettleDeadline)
		if err != nil || o.ReceiveAddress != want || o.Amount.String() != "12500000" || o.Symbol != "USDC" {
			t.Fatalf("option %+v: want address %s and 12500000 USDC (%v)", o, want, err)
		}
	}
	if inv.Options[0].ReceiveAddress == inv.Options[1].ReceiveAddress {
		t.Fatalf("both options share %s", inv.Options[0].ReceiveAddress)
	}

	// An option's id reads the invoice; the list shows it once; the next invoice takes the next number.
	if byOption, err := s.Get(ctx, inv.Options[1].ID); err != nil || byOption.ID != inv.ID {
		t.Fatalf("get by option: %s, %v", byOption.ID, err)
	}
	if page, err := s.List(ctx, profile, "", 10, "", search.Query{}); err != nil || len(page.Items) != 1 {
		t.Fatalf("list: %d items, %v", len(page.Items), err)
	}
	fixed, _, err := s.Create(ctx, profile, "key-2", Request{ChainID: 84532, Token: usdc, Amount: "5000000"})
	if err != nil || fixed.Number != 2 || len(fixed.Options) != 1 || fixed.Options[0].ID != fixed.ID {
		t.Fatalf("fixed: number %d, %d options, %v", fixed.Number, len(fixed.Options), err)
	}

	// The same request again, written another way, is the same invoice; another amount with the key is a conflict.
	if again, created, err := s.Create(ctx, profile, "key-1", Request{AmountUSD: "12.50", Details: Details{Title: "Logo"}}); err != nil ||
		created || again.ID != inv.ID || len(again.Options) != 2 {
		t.Fatalf("replay: %s created %v, %v", again.ID, created, err)
	}
	if _, _, err := s.Create(ctx, profile, "key-1", Request{AmountUSD: "13", Details: Details{Title: "Logo"}}); !errors.Is(err, ErrConflict) {
		t.Fatalf("another amount with the key: %v", err)
	}

	for _, bad := range []Request{
		{AmountUSD: "0.0000001"}, // finer than USDC's 6 decimals
		{AmountUSD: "0"},
		{AmountUSD: "1e3"},
		{AmountUSD: "12.5", ChainID: 84532, Token: usdc, Amount: "5000000"},
	} {
		if _, _, err := s.Create(ctx, profile, "bad-"+bad.AmountUSD, bad); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%+v: err = %v, want ErrInvalid", bad, err)
		}
	}

	if _, err := pool.Exec(ctx, "DELETE FROM chain_cursors"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Create(ctx, profile, "key-3", Request{AmountUSD: "1"}); !errors.Is(err, ErrNotWatched) {
		t.Fatalf("no chain watched: err = %v, want ErrNotWatched", err)
	}
}
