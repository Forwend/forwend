package worker

import (
	"context"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/watcher"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5/pgxpool"
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

// missedDeposit sets up an invoice with the given settle deadline and pays it in a block the regular scan has passed
// without seeing (its cursor is far above the deposit's block). It returns the database, the worker and the
// invoice's payment status.
func missedDeposit(t *testing.T, ctx context.Context, settleDeadline int64) (*pgxpool.Pool, *Worker, *chaintest.Anvil, func() string) {
	t.Helper()
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
		SELECT $4, id, $1, 'evm', $2, 5000000, $5 - 86400, $5,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    $3, 'key-1', decode(repeat('00', 32), 'hex') FROM p`, chaintest.ChainID, token, receive, missedID,
		settleDeadline); err != nil {
		t.Fatal(err)
	}
	w := New(pool, map[uint64]chain.Spec{chaintest.ChainID: {ChainID: chaintest.ChainID,
		Public: []string{a.URL, strings.Replace(a.URL, "127.0.0.1", "localhost", 1)}}}, nil, 1000)
	t.Cleanup(w.Close)
	w.Round(ctx) // the first scan starts the chain's cursor
	a.Transfer(token, receive, "5000000")
	a.Mine(watcher.RescanDepth + 20)
	if _, err := pool.Exec(ctx, `UPDATE chain_cursors SET last_scanned_block = last_finalized_block + $1,
		last_finalized_block = last_finalized_block + $1`, watcher.RescanDepth+10); err != nil {
		t.Fatal(err)
	}
	status := func() string {
		var s string
		if err := pool.QueryRow(ctx, "SELECT payment_status FROM invoices").Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	w.Round(ctx)
	if got := status(); got != "open" {
		t.Fatalf("before the recheck: invoice %s, want open (the scan never saw the deposit)", got)
	}
	return pool, w, a, status
}

const missedID = "0x0101010101010101010101010101010101010101010101010101010101010101"

func recheck(t *testing.T, ctx context.Context, pool *pgxpool.Pool, a *chaintest.Anvil) invoice.Recheck {
	t.Helper()
	client, err := ethclient.Dial(a.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	found, err := invoice.NewService(pool).Recheck(ctx, missedID,
		ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: client}))
	if err != nil {
		t.Fatal(err)
	}
	return found
}

// R-55: a deposit the regular scan never saw is booked only after Check status asks for a rescan; the next round
// finds it from the invoice's creation block and books it.
func TestRecheckBooksADepositTheScanMissed(t *testing.T) {
	ctx := context.Background()
	pool, w, a, status := missedDeposit(t, ctx, 1800086400)
	if found := recheck(t, ctx, pool, a); found.OnChain.Int64() != 5000000 || found.Recorded.Sign() != 0 || !found.Rescanning {
		t.Fatalf("recheck: %+v, want 5000000 on chain, none recorded, rescanning", found)
	}
	w.Round(ctx)
	if got := status(); got != "paid" {
		t.Fatalf("after the recheck's rescan: invoice %s, want paid", got)
	}
	var pending bool
	if err := pool.QueryRow(ctx, "SELECT rescan_requested_at IS NOT NULL FROM invoice_rechecks").Scan(&pending); err != nil || pending {
		t.Fatalf("rescan still asked: %v (%v)", pending, err)
	}
}

// An invoice the regular scan no longer watches (30 days after its settle deadline) is not rescanned either: its money
// is the refund authority's, so the request is dropped and nothing is booked.
func TestRecheckLeavesInvoicesPastTheWatchWindow(t *testing.T) {
	ctx := context.Background()
	pool, w, a, status := missedDeposit(t, ctx, 86401)
	if found := recheck(t, ctx, pool, a); !found.Rescanning {
		t.Fatalf("recheck: %+v, want a rescan asked (the api does not know the watch window)", found)
	}
	w.Round(ctx)
	var transfers int
	var pending bool
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM chain_transfers),
		(SELECT rescan_requested_at IS NOT NULL FROM invoice_rechecks)`).Scan(&transfers, &pending); err != nil {
		t.Fatal(err)
	}
	if transfers != 0 || pending || status() != "open" {
		t.Fatalf("past the window: %d transfers recorded, rescan pending %v, invoice %s; want none, false, open",
			transfers, pending, status())
	}
}
