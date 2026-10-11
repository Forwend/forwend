package watcher

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
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

// A log query the RPC refuses for its size or rate is read again in half the range, down to MinRange, and the range
// doubles back after each answer. The answered ranges still cover every block once, in order, and the deposit is found.
func TestLogRangeHalvesAndGrowsBack(t *testing.T) {
	for name, c := range map[string]struct {
		refuse    func(blocks uint64, earlier int) chaintest.Fault
		wantSizes []uint64 // the first ranges asked for
		wantErr   bool
	}{
		"too many results over 700 blocks": {refuse: func(blocks uint64, _ int) chaintest.Fault {
			if blocks > 700 {
				return chaintest.TooManyResults
			}
			return chaintest.Forward
		}, wantSizes: []uint64{2000, 1000, 500, 1000, 500}},
		"HTTP 429 on the first query": {refuse: func(_ uint64, earlier int) chaintest.Fault {
			if earlier == 0 {
				return chaintest.HTTP429
			}
			return chaintest.Forward
		}, wantSizes: []uint64{2000, 1000, 2000}},
		"refused down to the floor": {refuse: func(uint64, int) chaintest.Fault { return chaintest.TooManyResults },
			wantSizes: []uint64{2000, 1000, 500, 250, 125, 62, MinRange}, wantErr: true},
	} {
		t.Run(name, func(t *testing.T) {
			e := setup(t)
			e.anvil.Mine(1500)
			tx := e.anvil.Transfer(e.token, receive, "5000000")
			e.anvil.Mine(1500)
			proxy := e.anvil.Proxy()
			queries := 0
			proxy.Fail(func(call chaintest.Call) chaintest.Fault {
				if call.Method != "eth_getLogs" {
					return chaintest.Forward
				}
				from, to := logRange(t, call)
				queries++
				return c.refuse(to-from+1, queries-1)
			})
			client, err := rpc.Dial(proxy.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			e.chain = NewChain(e.pool, chaintest.ChainID, client)
			latest, err := ethclient.NewClient(e.anvil.RPC).BlockNumber(context.Background())
			if err != nil {
				t.Fatal(err)
			}

			err = e.chain.Scan(context.Background())
			var sizes []uint64
			var answered [][2]uint64
			for _, call := range proxy.Calls() {
				if call.Method == "eth_getLogs" {
					from, to := logRange(t, call)
					sizes = append(sizes, to-from+1)
					if call.Fault == chaintest.Forward {
						answered = append(answered, [2]uint64{from, to})
					}
				}
			}
			if len(sizes) < len(c.wantSizes) || !slices.Equal(sizes[:len(c.wantSizes)], c.wantSizes) {
				t.Fatalf("ranges asked %v, want them to start %v", sizes, c.wantSizes)
			}
			if c.wantErr {
				if err == nil || len(sizes) != len(c.wantSizes) || e.chain.span != MinRange {
					t.Fatalf("scan error %v after ranges %v; want an error once %d blocks are refused", err, sizes, MinRange)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			for i := 1; i < len(answered); i++ {
				if answered[i][0] != answered[i-1][1]+1 {
					t.Fatalf("answered ranges %v leave a gap or overlap", answered)
				}
			}
			if answered[len(answered)-1][1] != latest {
				t.Fatalf("answered ranges %v end before the latest block %d", answered, latest)
			}
			if got, n := e.rows(t); n != 1 || got[tx][0] != "confirmed" {
				t.Fatalf("deposits %v, want the one deposit confirmed", got)
			}
		})
	}
}

// logRange is an eth_getLogs call's block range. It may run in the proxy's goroutine, so it reports with Errorf.
func logRange(t *testing.T, call chaintest.Call) (uint64, uint64) {
	t.Helper()
	var filter struct{ FromBlock, ToBlock hexutil.Uint64 }
	if len(call.Params) != 1 || json.Unmarshal(call.Params[0], &filter) != nil {
		t.Errorf("eth_getLogs params %s", call.Params)
	}
	return uint64(filter.FromBlock), uint64(filter.ToBlock)
}

func TestLongBacklogIsCaughtUpOverSeveralScans(t *testing.T) {
	e := setup(t)
	defer func(limit uint64) { scanLimit = limit }(scanLimit)
	scanLimit = RescanDepth + 300
	e.anvil.Mine(3 * RescanDepth)
	tx := e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Mine(2)
	cursor := func() (block int64) {
		t.Helper()
		if err := e.pool.QueryRow(context.Background(), "SELECT last_finalized_block FROM chain_cursors").Scan(&block); err != nil {
			t.Fatal(err)
		}
		return block
	}
	scans, last := 0, cursor()
	for got, _ := e.rows(t); got[tx] == nil; got, _ = e.rows(t) {
		if scans++; scans > 40 {
			t.Fatalf("deposit not found after %d scans; cursor at %d", scans-1, last)
		}
		e.scan(t)
		if now := cursor(); now <= last {
			t.Fatalf("scan %d left the cursor at %d (was %d)", scans, now, last)
		} else {
			last = now
		}
	}
	if scans < 2 {
		t.Fatalf("found in %d scan; want the backlog read in parts", scans)
	}
}

// A deposit already recorded under another final block, mined again, is skipped with an alert: the chain's scan goes on.
func TestDepositMinedAgainUnderAFinalBlockIsSkipped(t *testing.T) {
	e := setup(t)
	tx := e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Mine(2)
	e.scan(t)
	if _, err := e.pool.Exec(context.Background(), `UPDATE chain_transfers SET block_hash = '0x' || repeat('ee', 32)
		WHERE tx_hash = $1`, tx); err != nil {
		t.Fatal(err)
	}
	e.scan(t)
	if got, n := e.rows(t); n != 1 || got[tx][0] != "confirmed" {
		t.Fatalf("rows %v", got)
	}
}

// Invoices 30 days past their settle deadline leave the scan: the refund authority moves late money from the chain.
func TestLongClosedInvoicesAreNotWatched(t *testing.T) {
	e := setup(t)
	const old = "0x00000000000000000000000000000000000000ad"
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('03', 32), profile_id, chain_id, chain_family, token_contract, amount, 1, 86401,
		    recipient_address, receive_method, factory_address, $1, 'key-old', request_hash FROM invoices`, old); err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(e.token, old, "5000000")
	e.anvil.Mine(2)
	e.scan(t)
	if got, n := e.rows(t); n != 0 {
		t.Fatalf("a long-closed invoice was scanned: %v", got)
	}
}

// A deposit seen just before its invoice leaves the scan keeps the invoice watched until it confirms: a detected row
// left behind would hold every later scan's start and stop the chain.
func TestInvoiceLeavingTheScanWithADetectedDepositStaysUntilItConfirms(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	const closing = "0x00000000000000000000000000000000000000ad"
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('03', 32), profile_id, chain_id, chain_family, token_contract, amount, 1,
		    extract(epoch FROM now())::bigint - 30 * 86400 + 3, recipient_address, receive_method, factory_address, $1,
		    'key-closing', request_hash FROM invoices`, closing); err != nil {
		t.Fatal(err)
	}
	late := e.anvil.Transfer(e.token, closing, "5000000")
	e.scan(t)
	if got, _ := e.rows(t); got[late][0] != "detected" {
		t.Fatalf("rows %v", got)
	}
	time.Sleep(4 * time.Second) // the invoice passes settle deadline + 30 days while its deposit is not final
	e.anvil.Mine(2)
	e.scan(t)
	if got, _ := e.rows(t); got[late][0] != "confirmed" {
		t.Fatalf("the deposit of an invoice that left the scan: %v, want confirmed", got[late])
	}
}
