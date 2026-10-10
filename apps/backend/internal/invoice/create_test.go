package invoice

import (
	"context"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
)

const usdc = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"

// A request whose key is being inserted by another transaction waits for it, then returns that invoice.
func TestCreateLosesTheInsertRaceToTheSameKey(t *testing.T) {
	ctx := context.Background()
	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var profile string
	err = pool.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', $1, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w1', 'evm', '0x1111111111111111111111111111111111111111' FROM p)
		SELECT id::text FROM p`, usdc).Scan(&profile)
	if err != nil {
		t.Fatal(err)
	}
	req := Request{ChainID: 84532, Token: usdc, Amount: "5000000"}

	// The other request's insert, not yet committed.
	other, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Rollback(ctx)
	winner := "0xab" + strings.Repeat("0", 60) + "cd"
	_, err = other.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		VALUES ($1, $2, 84532, 'evm', $3, 5000000, 1800000000, 1800086400, '0x1111111111111111111111111111111111111111',
		    'evm_create2', '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333',
		    'key-1', $4)`, winner, profile, usdc, requestHash(84532, usdc, big.NewInt(5000000), DefaultExpiresIn))
	if err != nil {
		t.Fatal(err)
	}

	type result struct {
		inv     Invoice
		created bool
		err     error
	}
	done := make(chan result)
	go func() {
		inv, created, err := NewService(pool).Create(ctx, profile, "key-1", req)
		done <- result{inv, created, err}
	}()
	select {
	case r := <-done:
		t.Fatalf("Create did not wait for the other insert: %+v", r)
	case <-time.After(300 * time.Millisecond):
	}
	if err := other.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	r := <-done
	if r.err != nil || r.created || r.inv.ID != winner {
		t.Fatalf("got %+v, want the other request's invoice %s, not created", r, winner)
	}
}
