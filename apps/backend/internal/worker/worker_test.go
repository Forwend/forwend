package worker

import (
	"context"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
)

const receive = "0x00000000000000000000000000000000000000aa"

// The primary RPC starts answering 429 in the middle of a round: its calls move to the next host, the second moves
// to a third host for the balance check (D-15), and the same round still records the deposit and marks the invoice paid.
func TestRoundSurvivesAnRPCGoing429MidRound(t *testing.T) {
	ctx := context.Background()
	a := chaintest.Start(t)
	token := a.DeployToken()
	a.Mint(token, "100000000")
	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES ($1, 'evm', 'anvil', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES ($1, 'evm', $2, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id)
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('01', 32), id, $1, 'evm', $2, 5000000, 1800000000, 1800086400,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    $3, 'key-1', decode(repeat('00', 32), 'hex') FROM p`, chaintest.ChainID, token, receive); err != nil {
		t.Fatal(err)
	}

	limited := a.Proxy()
	w := New(pool, map[uint64]chain.Spec{chaintest.ChainID: {ChainID: chaintest.ChainID,
		Public: []string{limited.URL, a.URL, strings.Replace(a.URL, "127.0.0.1", "localhost", 1)}}}, nil, 1000)
	defer w.Close()
	w.Round(ctx) // the first scan starts the chain's cursor

	a.Transfer(token, receive, "5000000")
	a.Mine(2) // the deposit's block is finalized
	earlier := len(limited.Calls())
	going := false
	limited.Fail(func(c chaintest.Call) chaintest.Fault {
		going = going || c.Method == "eth_getLogs"
		if going {
			return chaintest.HTTP429
		}
		return chaintest.Forward
	})
	w.Round(ctx)

	var status string
	if err := pool.QueryRow(ctx, "SELECT payment_status FROM invoices").Scan(&status); err != nil || status != "paid" {
		t.Fatalf("invoice %s (%v) after the round, want paid", status, err)
	}
	answered, refused := 0, 0
	for _, c := range limited.Calls()[earlier:] {
		if c.Fault == chaintest.HTTP429 {
			refused++
		} else {
			answered++
		}
	}
	if answered == 0 || refused == 0 {
		t.Fatalf("this round the RPC answered %d calls and refused %d; want it to go 429 mid-round", answered, refused)
	}
}
