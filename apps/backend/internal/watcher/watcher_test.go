package watcher

import (
	"context"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5/pgxpool"
)

const receive = "0x00000000000000000000000000000000000000aa"

type env struct {
	anvil *chaintest.Anvil
	pool  *pgxpool.Pool
	token string
	chain *Chain
}

// setup runs Anvil with a mock USDC and one invoice paid at receive, and scans once so the cursor exists.
func setup(t *testing.T) env {
	t.Helper()
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
	_, err = pool.Exec(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES ($1, 'evm', 'anvil', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES ($1, 'evm', $2, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id)
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('01', 32), id, $1, 'evm', $2, 5000000, 1800000000, 1800086400,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    $3, 'key-1', decode(repeat('00', 32), 'hex') FROM p`, chaintest.ChainID, token, receive)
	if err != nil {
		t.Fatal(err)
	}
	e := env{anvil: a, pool: pool, token: token, chain: NewChain(pool, chaintest.ChainID, a.RPC)}
	e.scan(t)
	return e
}

func (e env) scan(t *testing.T) {
	t.Helper()
	if err := e.chain.Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
}

// rows returns tx hash -> status for every recorded transfer, and the row count.
func (e env) rows(t *testing.T) (map[string][]string, int) {
	t.Helper()
	rows, err := e.pool.Query(context.Background(), "SELECT tx_hash, status FROM chain_transfers ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out, n := map[string][]string{}, 0
	for rows.Next() {
		var hash, status string
		if err := rows.Scan(&hash, &status); err != nil {
			t.Fatal(err)
		}
		out[hash] = append(out[hash], status)
		n++
	}
	return out, n
}

func TestDepositIsDetectedThenConfirmed(t *testing.T) {
	e := setup(t)
	tx := e.anvil.Transfer(e.token, receive, "5000000")
	e.scan(t)
	if got, n := e.rows(t); n != 1 || got[tx][0] != "detected" {
		t.Fatalf("after the transfer block: %v", got)
	}
	var amount, from string
	var blockTime int64
	err := e.pool.QueryRow(context.Background(), "SELECT amount::text, from_address, block_time FROM chain_transfers").
		Scan(&amount, &from, &blockTime)
	if err != nil || amount != "5000000" || from != chaintest.Sender || blockTime == 0 {
		t.Fatalf("row: amount %s from %s time %d err %v", amount, from, blockTime, err)
	}
	e.anvil.Mine(1) // finalized is now one block short of the deposit
	e.scan(t)
	if got, _ := e.rows(t); got[tx][0] != "detected" {
		t.Fatalf("one block later: %v", got)
	}
	e.anvil.Mine(1) // the deposit's block is finalized
	e.scan(t)
	if got, n := e.rows(t); n != 1 || got[tx][0] != "confirmed" {
		t.Fatalf("once finalized: %v", got)
	}
}

func TestOnlyTheInvoiceTokenToAReceiveAddressCounts(t *testing.T) {
	e := setup(t)
	lookalike := e.anvil.DeployToken() // same name, symbol and Transfer event
	e.anvil.Mint(lookalike, "100000000")
	// The look-alike is also a listed token of another invoice, so the RPC filter returns its logs too.
	_, err := e.pool.Exec(context.Background(), `
		WITH tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES ($1, 'evm', $2, 'OTHER', 6, true))
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('02', 32), profile_id, $1, 'evm', $2, 5000000, 1800000000, 1800086400,
		    recipient_address, 'evm_create2', factory_address, '0x00000000000000000000000000000000000000cc', 'key-2',
		    request_hash FROM invoices`, chaintest.ChainID, lookalike)
	if err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(lookalike, receive, "5000000")
	e.anvil.Transfer(e.token, "0x00000000000000000000000000000000000000bb", "5000000")
	e.anvil.Mine(3)
	e.scan(t)
	if got, n := e.rows(t); n != 0 {
		t.Fatalf("look-alike token or unknown address recorded: %v", got)
	}
}

func TestReorgMarksTheDepositReorged(t *testing.T) {
	e := setup(t)
	tx := e.anvil.Transfer(e.token, receive, "5000000")
	raw := e.anvil.RawTx(tx)
	e.scan(t)

	e.anvil.Reorg(1) // the block with the transfer is replaced by an empty one
	e.scan(t)
	if got, n := e.rows(t); n != 1 || got[tx][0] != "reorged" {
		t.Fatalf("after the reorg: %v", got)
	}

	// The same signed transaction is mined again in another block: same tx hash and log index, new row.
	e.anvil.SendRaw(raw)
	e.scan(t)
	if got, n := e.rows(t); n != 2 || got[tx][0] != "reorged" || got[tx][1] != "detected" {
		t.Fatalf("after the transaction is mined again: %v", got)
	}

	// A restarted worker resumes from the cursor; scanning again adds nothing.
	restarted := env{anvil: e.anvil, pool: e.pool, token: e.token, chain: NewChain(e.pool, chaintest.ChainID, e.anvil.RPC)}
	restarted.scan(t)
	restarted.scan(t)
	e.anvil.Mine(2)
	restarted.scan(t)
	if got, n := e.rows(t); n != 2 || got[tx][1] != "confirmed" {
		t.Fatalf("after a restart: %v", got)
	}
}
