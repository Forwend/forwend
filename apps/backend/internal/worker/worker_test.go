package worker

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/watcher"
	"github.com/jackc/pgx/v5/pgxpool"
)

const receive = "0x00000000000000000000000000000000000000aa"

// Three hosts: the primary's calls move to the next one, and the balance check's second RPC to the third (D-15).
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
		AllowLoopback: true, Endpoints: []chain.Endpoint{{ID: "rpc-0", Provider: "provider-0", Role: chain.Primary, Tier: chain.Private, Priority: 0, URL: limited.URL, BudgetGroup: "budget-0"}, {ID: "rpc-1", Provider: "provider-1", Role: chain.Confirmation, Tier: chain.Public, Priority: 1, URL: a.URL, BudgetGroup: "budget-1"}, {ID: "rpc-2", Provider: "provider-2", Role: chain.Primary, Tier: chain.Public, Priority: 2, URL: strings.Replace(a.URL, "127.0.0.1", "localhost", 1), BudgetGroup: "budget-2"}}}}, 1000)
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

// missedDeposit pays an invoice in a block the regular scan has passed without seeing (its cursor is far above the
// deposit's block).
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
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash, pay_token)
		SELECT $4, id, $1, 'evm', $2, 5000000, $5 - 86400, $5,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    $3, 'key-1', decode(repeat('00', 32), 'hex'), $6 FROM p`, chaintest.ChainID, token, receive, missedID,
		settleDeadline, missedToken); err != nil {
		t.Fatal(err)
	}
	w := New(pool, map[uint64]chain.Spec{chaintest.ChainID: {ChainID: chaintest.ChainID,
		AllowLoopback: true, Endpoints: []chain.Endpoint{{ID: "rpc-0", Provider: "provider-0", Role: chain.Primary, Tier: chain.Public, Priority: 0, URL: a.URL, BudgetGroup: "budget-0"}, {ID: "rpc-1", Provider: "provider-1", Role: chain.Confirmation, Tier: chain.Public, Priority: 1, URL: strings.Replace(a.URL, "127.0.0.1", "localhost", 1), BudgetGroup: "budget-1"}}}}, 1000)
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

// missedToken is the invoice's pay link token, and missedID its id (D-86).
const missedToken = "0101010101010101010101010101010101010101010101010101010101010101"

var missedID = crypto.Keccak256Hash(common.FromHex(missedToken)).Hex()

func recheck(t *testing.T, ctx context.Context, pool *pgxpool.Pool, a *chaintest.Anvil) invoice.Recheck {
	t.Helper()
	client, err := ethclient.Dial(a.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	found, err := invoice.NewService(pool).Recheck(ctx, missedToken,
		ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: client}), func(string) time.Duration { return 0 })
	if err != nil {
		t.Fatal(err)
	}
	return found
}

// R-55: the rescan starts at the invoice's creation block.
func TestRecheckBooksADepositTheScanMissed(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	pool, w, a, status := missedDeposit(t, ctx, 1800086400)
	if found := recheck(t, ctx, pool, a); found.OnChain.Int64() != 5000000 || found.Recorded.Sign() != 0 || !found.Rescanning {
		t.Fatalf("recheck: %+v, want 5000000 on chain, none recorded, rescanning", found)
	}
	for status() != "paid" && ctx.Err() == nil {
		w.Round(ctx)
		time.Sleep(10 * time.Millisecond)
	}
	if got := status(); got != "paid" {
		t.Fatalf("after the recheck's rescan: invoice %s, want paid", got)
	}
	var pending bool
	if err := pool.QueryRow(ctx, "SELECT rescan_requested_at IS NOT NULL FROM invoice_rechecks").Scan(&pending); err != nil || pending {
		t.Fatalf("rescan still asked: %v (%v)", pending, err)
	}
}

// Past the watch window (30 days after the settle deadline) the money is the refund authority's: nothing is booked.
func TestRecheckLeavesInvoicesPastTheWatchWindow(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	pool, w, a, status := missedDeposit(t, ctx, 86401)
	if found := recheck(t, ctx, pool, a); !found.Rescanning {
		t.Fatalf("recheck: %+v, want a rescan asked (the api does not know the watch window)", found)
	}
	for ctx.Err() == nil {
		w.Round(ctx)
		var pending bool
		if err := pool.QueryRow(ctx, "SELECT rescan_requested_at IS NOT NULL FROM invoice_rechecks").Scan(&pending); err != nil {
			t.Fatal(err)
		}
		if !pending {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
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

func TestActivePaymentCompletesWhileLegacyReceiverScanHangs(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	a := chaintest.Start(t)
	token := a.DeployToken()
	a.Mint(token, "100000000")
	a.Mine(watcher.RescanDepth + 20)
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
   $3, 'active', decode(repeat('00', 32), 'hex') FROM p`, chaintest.ChainID, token, receive); err != nil {
		t.Fatal(err)
	}
	proxy := a.Proxy()
	w := New(pool, map[uint64]chain.Spec{chaintest.ChainID: {ChainID: chaintest.ChainID,
		AllowLoopback: true, Endpoints: []chain.Endpoint{{ID: "rpc-0", Provider: "provider-0", Role: chain.Primary, Tier: chain.Private, Priority: 0, URL: proxy.URL, BudgetGroup: "budget-0"}, {ID: "rpc-1", Provider: "provider-1", Role: chain.Confirmation, Tier: chain.Public, Priority: 1, URL: strings.Replace(a.URL, "127.0.0.1", "localhost", 1), BudgetGroup: "budget-1"}}}}, 1000)
	defer w.Close()
	w.Round(ctx)
	w.historical.Wait()
	const legacyAddress = "0x00000000000000000000000000000000000000bb"
	if _, err := pool.Exec(ctx, `INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount,
  expires_at, settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
  SELECT '0x' || repeat('02',32), profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
   recipient_address, receive_method, factory_address, $1, 'legacy', request_hash FROM invoices`, legacyAddress); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE receiver_scans SET legacy=true, start_block=0, next_block=0 WHERE invoice_id='0x' || repeat('02',32)"); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	var once sync.Once
	proxy.Fail(func(call chaintest.Call) chaintest.Fault {
		if call.Method == "eth_getLogs" && len(call.Params) > 0 &&
			strings.Contains(string(call.Params[0]), `"fromBlock":"0x0"`) &&
			strings.Contains(string(call.Params[0]), legacyAddress[2:]) {
			once.Do(func() { close(started) })
			return chaintest.Hang
		}
		return chaintest.Forward
	})
	a.Transfer(token, receive, "5000000")
	a.Mine(2)
	w.Tick(ctx)
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("legacy scan did not start")
	}
	w.jobs.Wait()
	var status string
	var complete bool
	var proofs int
	if err := pool.QueryRow(ctx, `SELECT i.payment_status, s.history_complete,
  (SELECT count(*) FROM receiver_deposit_proofs p JOIN chain_transfers d ON d.id=p.chain_transfer_id WHERE d.invoice_id=i.id)
  FROM invoices i JOIN receiver_scans s ON s.invoice_id=i.id WHERE i.receive_address=$1`, receive).Scan(&status, &complete, &proofs); err != nil {
		t.Fatal(err)
	}
	if status != "paid" || !complete || proofs != 1 {
		t.Fatalf("active payment: status=%s complete=%v proofs=%d", status, complete, proofs)
	}
	if w.historical.Idle(chaintest.ChainID) {
		t.Fatal("historical scan finished before active payment; blocking was not exercised")
	}
	if err := pool.QueryRow(ctx, "SELECT history_complete FROM receiver_scans WHERE invoice_id='0x' || repeat('02',32)").Scan(&complete); err != nil {
		t.Fatal(err)
	}
	if complete {
		t.Fatal("hanging legacy scan was marked verified")
	}
}
