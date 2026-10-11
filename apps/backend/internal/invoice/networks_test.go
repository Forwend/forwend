package invoice

import (
	"context"
	"errors"
	"testing"
)

// D-38: migrations add each planned network and token switched off; once a database turns them on, invoices use them.
func TestPlannedNetworksTakeInvoicesOnceEnabled(t *testing.T) {
	for _, n := range []struct {
		chainID     uint64
		name, token string
		symbol      string
		decimals    int
	}{
		{421614, "arbitrum-sepolia", "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", "USDC", 6},
		{5042002, "arc-testnet", "0x3600000000000000000000000000000000000000", "USDC", 6},
		{42431, "tempo-moderato", "0x20c0000000000000000000006a37da5c996874be", "OUSD", 6},
	} {
		t.Run(n.name, func(t *testing.T) {
			ctx := context.Background()
			pool, profile := open(t)
			s := NewService(pool)
			req := Request{ChainID: n.chainID, Token: n.token, Amount: "5000000"}
			if _, _, err := s.Create(ctx, profile, "off", req); !errors.Is(err, ErrInvalid) {
				t.Fatalf("switched off: err = %v, want ErrInvalid", err)
			}
			if _, err := pool.Exec(ctx, `UPDATE chains SET enabled = true WHERE chain_id = $1`, n.chainID); err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(ctx, `UPDATE tokens SET enabled = true WHERE chain_id = $1`, n.chainID); err != nil {
				t.Fatal(err)
			}
			created, _, err := s.Create(ctx, profile, "on", req)
			if err != nil {
				t.Fatal(err)
			}
			inv, err := s.Get(ctx, created.ID)
			if err != nil {
				t.Fatal(err)
			}
			if inv.ChainID != n.chainID || inv.Network != n.name || inv.Symbol != n.symbol || inv.Decimals != n.decimals {
				t.Fatalf("invoice on %d %q %s/%d, want %d %q %s/%d", inv.ChainID, inv.Network, inv.Symbol, inv.Decimals,
					n.chainID, n.name, n.symbol, n.decimals)
			}
		})
	}
}
