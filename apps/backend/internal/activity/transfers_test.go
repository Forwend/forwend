package activity

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// addTransfer records wallet's side of log n (tx and block hash 0x00…n, block n) at blockTime.
func addTransfer(t *testing.T, pool *pgxpool.Pool, wallet string, n int, blockTime int64, direction, status string) string {
	t.Helper()
	hash := fmt.Sprintf("0x%064x", n)
	exec(t, pool, `INSERT INTO wallet_transfers (chain_id, chain_family, token_contract, wallet_address, direction,
		    counterparty, tx_hash, log_index, block_hash, block_number, block_time, amount, status)
		VALUES (84532, 'evm', $1, $2, $3, $4, $5, 0, $5, $6, $7, 1000000, $8)`,
		usdc, wallet, direction, payer, hash, n, blockTime, status)
	return hash
}

func TestTransfersNewestFirstInPages(t *testing.T) {
	pool := open(t)
	const mine, theirs = "0x000000000000000000000000000000000000000a", "0x000000000000000000000000000000000000000b"
	var profile, other, empty string
	if err := pool.QueryRow(context.Background(), `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', $1, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM u RETURNING id),
		     o AS (INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM u RETURNING id),
		     e AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w1', 'evm', $2 FROM p UNION ALL SELECT id, 'privy', 'w2', 'evm', $3 FROM o)
		SELECT (SELECT id::text FROM p), (SELECT id::text FROM o), (SELECT id::text FROM e)`, usdc, mine, theirs).
		Scan(&profile, &other, &empty); err != nil {
		t.Fatal(err)
	}
	s := NewService(pool)
	ctx := context.Background()

	if first, err := s.Transfers(ctx, empty, "", DefaultLimit); err != nil || len(first.Items) != 0 || first.NextCursor != "" {
		t.Fatalf("new profile: %+v, %v; want an empty list", first, err)
	}

	a := addTransfer(t, pool, mine, 1, 100, "in", "confirmed")
	b := addTransfer(t, pool, mine, 2, 200, "out", "detected")
	c := addTransfer(t, pool, mine, 3, 200, "in", "confirmed") // same time as b: the later row comes first
	addTransfer(t, pool, mine, 4, 300, "in", "reorged")        // left out
	addTransfer(t, pool, theirs, 5, 400, "in", "confirmed")    // another profile's: left out
	// One transfer between the two wallets: out in this profile's list, in in the other's.
	d := addTransfer(t, pool, mine, 6, 500, "out", "confirmed")
	addTransfer(t, pool, theirs, 6, 500, "in", "confirmed")
	want := []string{"out " + d, "in " + c, "out " + b, "in " + a}

	// Every page size, so a page boundary falls between every two items, including b and c with the same time.
	for limit := 1; limit <= len(want); limit++ {
		var got []string
		cursor := ""
		for pages := 1; ; pages++ {
			page, err := s.Transfers(ctx, profile, cursor, limit)
			if err != nil {
				t.Fatal(err)
			}
			for _, it := range page.Items {
				got = append(got, it.Direction+" "+it.TxHash)
			}
			if cursor = page.NextCursor; cursor == "" {
				if wantPages := (len(want) + limit - 1) / limit; pages != wantPages {
					t.Fatalf("limit %d: %d pages, want %d", limit, pages, wantPages)
				}
				break
			}
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("limit %d: got %v\nwant %v", limit, got, want)
		}
	}

	theirsPage, err := s.Transfers(ctx, other, "", DefaultLimit)
	if err != nil || len(theirsPage.Items) != 2 || theirsPage.Items[0].Direction != "in" || theirsPage.Items[0].TxHash != d {
		t.Fatalf("the other profile: %+v, %v; want the transfer between the wallets as in, then its own", theirsPage, err)
	}

	top, _ := s.Transfers(ctx, profile, "", 3)
	if it := top.Items[2]; it.Status != "detected" || it.Amount.Int64() != 1000000 || it.Counterparty != payer ||
		it.ChainID != 84532 || it.Token != usdc || it.Symbol != "USDC" || it.Decimals != 6 || it.BlockNumber != 2 ||
		it.LogIndex != 0 || !it.At.Equal(time.Unix(200, 0)) {
		t.Fatalf("transfer item %+v", it)
	}

	for _, c := range []struct {
		cursor string
		limit  int
	}{{"", 0}, {"", MaxLimit + 1}, {"not base64!", 10}, {"MTIz", 10}, {encode(time.Unix(1, 0), Invoice, "x"), 10}} {
		if _, err := s.Transfers(ctx, profile, c.cursor, c.limit); !errors.Is(err, ErrInvalid) {
			t.Fatalf("cursor %q limit %d: %v, want ErrInvalid", c.cursor, c.limit, err)
		}
	}
}
