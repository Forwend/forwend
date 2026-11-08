package watcher

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const receive = "0x00000000000000000000000000000000000000aa"

func TestSingleReadExecutionErrorDoesNotStopOtherReads(t *testing.T) {
	e := setup(t)
	e.chain.batchSize = 1
	var output hexutil.Bytes
	var id hexutil.Uint64
	batch := []rpc.BatchElem{
		{Method: "eth_call", Args: []any{map[string]string{"to": e.token, "data": "0xffffffff"}, "latest"}, Result: &output},
		{Method: "eth_chainId", Result: &id},
	}
	if err := e.chain.batchCall(t.Context(), batch); err != nil {
		t.Fatal(err)
	}
	var executionError rpc.Error
	if !errors.As(batch[0].Error, &executionError) || batch[1].Error != nil || uint64(id) != chaintest.ChainID {
		t.Fatalf("execution error=%v, healthy read=%d/%v", batch[0].Error, id, batch[1].Error)
	}
}

type env struct {
	anvil *chaintest.Anvil
	pool  *pgxpool.Pool
	token string
	chain *Chain
}

// setup runs Anvil with a mock USDC and one invoice paid at receive, and scans once so the cursor exists.
func setup(t *testing.T) env {
	t.Helper()
	return setupChain(t, chaintest.Start(t))
}

func setupChain(t *testing.T, a *chaintest.Anvil) env {
	t.Helper()
	ctx := context.Background()
	token := a.DeployToken()
	a.Mint(token, "100000000")

	url := databasetest.Migrated(t, database.Migrate)
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
	// R-119.
	var scannedTime int64
	if err := e.pool.QueryRow(context.Background(), "SELECT last_scanned_time FROM chain_cursors").Scan(&scannedTime); err != nil ||
		scannedTime != e.anvil.Now() {
		t.Fatalf("scanned time %d (%v), want the latest block's %d", scannedTime, err, e.anvil.Now())
	}
	// The finalized block of the scan that saw it is kept: the deposit had 2 blocks to wait (R-73).
	wait := func() (n int64) {
		err := e.pool.QueryRow(context.Background(),
			"SELECT block_number - detected_finalized_block FROM chain_transfers").Scan(&n)
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	if got := wait(); got != 2 {
		t.Fatalf("blocks to wait when seen: %d", got)
	}
	e.anvil.Mine(1) // finalized is now one block short of the deposit
	e.scan(t)
	if got, _ := e.rows(t); got[tx][0] != "detected" {
		t.Fatalf("one block later: %v", got)
	}
	if got := wait(); got != 2 {
		t.Fatalf("a later scan changed the blocks to wait: %d", got)
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

// Zero-value transfers, as address-poisoning spam sends, are no payment: nothing is recorded, so nothing confirms.
func TestZeroValueTransferIsNoPayment(t *testing.T) {
	e := setup(t)
	e.anvil.Transfer(e.token, receive, "0")
	e.anvil.Mine(3)
	e.scan(t)
	if got, n := e.rows(t); n != 0 {
		t.Fatalf("a zero-value transfer recorded: %v", got)
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

func TestLogRangeRetainsAcceptedSize(t *testing.T) {
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
		}, wantSizes: []uint64{2000, 1000, 500, 500, 500}},
		"a rate limit keeps the range": {refuse: func(uint64, int) chaintest.Fault { return chaintest.HTTP429 },
			wantSizes: []uint64{2000}, wantErr: true},
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
				if call.Method == "eth_getLogs" && strings.Contains(string(call.Params[0]), transferTopic.Hex()) {
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
				if err == nil || len(sizes) != len(c.wantSizes) || e.chain.span != MaxRange {
					t.Fatalf("scan error %v after ranges %v, range now %d; want an error and the range kept", err, sizes, e.chain.span)
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

// logRange may run in the proxy's goroutine, so it reports with Errorf.
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
	defer func(chunks uint64) { scanChunks = chunks }(scanChunks)
	scanChunks = 2
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

func TestNarrowedLogRangeGrowsBack(t *testing.T) {
	e := setup(t)
	e.anvil.Mine(8 * MaxRange)
	proxy := e.anvil.Proxy()
	refusals := 0
	proxy.Fail(func(call chaintest.Call) chaintest.Fault {
		if call.Method != "eth_getLogs" {
			return chaintest.Forward
		}
		if from, to := logRange(t, call); to-from+1 > 700 && refusals < 2 {
			refusals++
			return chaintest.TooManyResults
		}
		return chaintest.Forward
	})
	client, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	e.chain = NewChain(e.pool, chaintest.ChainID, client)
	for e.chain.span < MaxRange {
		before := len(proxy.Calls())
		e.scan(t)
		if len(proxy.Calls()) == before {
			t.Fatalf("scans stopped with the range at %d blocks", e.chain.span)
		}
		if refusals < 2 {
			t.Fatal("the provider never refused a range")
		}
		if e.anvil.Mine(MaxRange); e.chain.span < MaxRange && len(proxy.Calls()) > 400 {
			t.Fatalf("range still %d blocks after %d calls; want it back at %d", e.chain.span, len(proxy.Calls()), MaxRange)
		}
	}
}

func TestSlowSmallRangeProviderStillMovesTheCursorEveryScan(t *testing.T) {
	e := setup(t)
	e.anvil.Mine(6 * MaxRange)
	tx := e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Mine(2)
	proxy := e.anvil.Proxy()
	proxy.Fail(func(call chaintest.Call) chaintest.Fault {
		if call.Method != "eth_getLogs" {
			return chaintest.Forward
		}
		if from, to := logRange(t, call); to-from+1 > 62 {
			return chaintest.TooManyResults
		}
		time.Sleep(5 * time.Millisecond)
		return chaintest.Forward
	})
	client, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	e.chain = NewChain(e.pool, chaintest.ChainID, client)
	cursor := func() (block int64) {
		t.Helper()
		if err := e.pool.QueryRow(context.Background(), "SELECT last_finalized_block FROM chain_cursors").Scan(&block); err != nil {
			t.Fatal(err)
		}
		return block
	}
	last := cursor()
	for scans := 1; ; scans++ {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		err := e.chain.ScanNew(ctx)
		cancel()
		if err != nil {
			t.Fatalf("scan %d: %v", scans, err)
		}
		if now := cursor(); now <= last {
			t.Fatalf("scan %d left the cursor at %d", scans, now)
		} else {
			last = now
		}
		if got, _ := e.rows(t); got[tx] != nil {
			return
		}
		if scans == 30 {
			t.Fatalf("deposit not found after %d scans; cursor at %d", scans, last)
		}
	}
}

// Rewriting block_hash makes the row look recorded under another final block.
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

func TestInvoiceLeavingTheScanWithADetectedDepositStaysUntilItConfirms(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	const closing = "0x00000000000000000000000000000000000000ad"
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('03', 32), profile_id, chain_id, chain_family, token_contract, amount, 1, 86401,
		    recipient_address, receive_method, factory_address, $1, 'key-closing', request_hash FROM invoices`,
		closing); err != nil {
		t.Fatal(err)
	}
	defer func(window time.Duration) { watchedAfterDeadline = window }(watchedAfterDeadline)
	watchedAfterDeadline = time.Since(time.Unix(86401, 0)) + time.Hour // still watched
	late := e.anvil.Transfer(e.token, closing, "5000000")
	e.scan(t)
	if got, _ := e.rows(t); got[late][0] != "detected" {
		t.Fatalf("rows %v", got)
	}
	watchedAfterDeadline = 0 // the invoice leaves the window while its deposit is not final
	e.anvil.Mine(2)
	e.scan(t)
	if got, _ := e.rows(t); got[late][0] != "confirmed" {
		t.Fatalf("the deposit of an invoice that left the scan: %v, want confirmed", got[late])
	}
}

// R-183, PLAN 11.10.3: an expired receiver past the watch window that holds late money stays watched while support's
// return is queued, so the refund the Safe sends weeks later is still recorded.
func TestReceiverWithAQueuedReturnStaysWatchedPastTheWindow(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	factory := e.anvil.DeployFactory()
	now := e.anvil.Now()
	terms := address.Terms{InvoiceID: [32]byte(common.FromHex("0x" + strings.Repeat("05", 32))),
		Recipient: common.HexToAddress("0x1111111111111111111111111111111111111111"), Token: common.HexToAddress(e.token),
		Amount: big.NewInt(5000000), ExpiresAt: uint64(now + 60), SettleDeadline: uint64(now + 120),
		IntendedChainID: chaintest.ChainID}
	addr, err := address.Receive(terms)
	if err != nil {
		t.Fatal(err)
	}
	held := strings.ToLower(common.Address(addr).Hex())
	if _, err := e.pool.Exec(ctx, `INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount,
		    expires_at, settle_deadline, recipient_address, receive_method, factory_address, receive_address,
		    idempotency_key, request_hash)
		SELECT '0x' || repeat('05', 32), profile_id, chain_id, chain_family, token_contract, amount, $1, $2,
		    recipient_address, receive_method, $3, $4, 'key-held', request_hash FROM invoices`,
		terms.ExpiresAt, terms.SettleDeadline, factory, held); err != nil {
		t.Fatal(err)
	}
	paid := e.anvil.Transfer(e.token, held, "5000000")
	e.scan(t)
	e.anvil.Mine(2)
	e.scan(t)
	// Booked as late money, held for the payer; then support queues its return.
	if _, err := e.pool.Exec(ctx, `WITH t AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
		SELECT invoice_id, 'deposit', id FROM chain_transfers WHERE tx_hash = $1 RETURNING id)
		INSERT INTO ledger_entries (transaction_id, account, amount)
		SELECT id, a, v FROM t, (VALUES ('receiver', 5000000), ('payer_held', -5000000)) AS e(a, v)`, paid); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `UPDATE invoices SET payment_status = 'expired', refund_status = 'refund_pending'
		WHERE receive_address = $1`, held); err != nil {
		t.Fatal(err)
	}
	defer func(window time.Duration) { watchedAfterDeadline = window }(watchedAfterDeadline)
	watchedAfterDeadline = time.Since(time.Unix(int64(terms.SettleDeadline), 0)) - time.Hour // past the window

	e.anvil.AsAuthority(factory, "deploy((bytes32,address,address,uint256,uint64,uint64,uint256,uint256,uint256))",
		fmt.Sprintf("(0x%s,0x1111111111111111111111111111111111111111,%s,5000000,%d,%d,%d,0,0)", strings.Repeat("05", 32),
			e.token, terms.ExpiresAt, terms.SettleDeadline, chaintest.ChainID))
	e.anvil.Wait(200)
	e.anvil.AsAuthority(held, "refund(address,uint256)", chaintest.Sender, "5000000")
	e.anvil.Mine(2)
	e.scan(t)
	var refunds int
	if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM receiver_outflows WHERE receiver_address = $1 AND kind = 'refund'",
		held).Scan(&refunds); err != nil || refunds != 1 {
		t.Fatalf("the queued return's refund: %d recorded, %v", refunds, err)
	}
}

// Here every eth_getLogs answer with a log is refused, as Infura refuses more than 10,000.
func TestLogSpamDoesNotStopTheChain(t *testing.T) {
	ctx := context.Background()
	e := setup(t)
	const victim = "0x00000000000000000000000000000000000000bb"
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('04', 32), profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, $1, 'key-victim', request_hash
		FROM invoices`, victim); err != nil {
		t.Fatal(err)
	}

	for range 6 {
		e.anvil.Transfer(e.token, receive, "0")
	}
	e.anvil.Mine(100)
	payment := e.anvil.Transfer(e.token, victim, "5000000")
	e.anvil.Mine(3)

	proxy := e.anvil.Proxy()
	proxy.Fail(func(call chaintest.Call) chaintest.Fault {
		if call.Method != "eth_getLogs" || len(call.Params) != 1 {
			return chaintest.Forward
		}
		var logs []json.RawMessage
		if err := e.anvil.RPC.Call(&logs, "eth_getLogs", call.Params[0]); err != nil {
			t.Errorf("count logs: %v", err)
			return chaintest.Forward
		}
		if len(logs) > 0 {
			return chaintest.TooManyResults
		}
		return chaintest.Forward
	})
	client, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	e.chain = NewChain(e.pool, chaintest.ChainID, client)

	var lastErr error
	for range 5 {
		lastErr = e.chain.Scan(ctx)
		if got, _ := e.rows(t); len(got[payment]) > 0 {
			return
		}
	}
	got, _ := e.rows(t)
	t.Fatalf("payment %s to another invoice never recorded after 5 scans (rows %v); last scan error: %v",
		payment, got, lastErr)
}

func TestOnlyNewFinalCanonicalEventsOfWatchedReceiversAreRecorded(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	invoices, err := e.chain.invoices(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id := "0x" + strings.Repeat("01", 32)
	amount := common.LeftPadBytes(big.NewInt(5000000).Bytes(), 32)
	settled := func(address common.Address, block uint64, hash common.Hash) types.Log {
		return types.Log{Address: address, BlockNumber: block, BlockHash: hash, TxHash: common.HexToHash("0xfeed"), Index: 1, Data: amount,
			Topics: []common.Hash{settledTopic, common.HexToHash(id), common.BytesToHash(common.HexToAddress("0x1111111111111111111111111111111111111111").Bytes())}}
	}
	final, other := common.HexToHash("0xf1"), common.HexToHash("0xf2")
	headers := map[uint64]header{5: {Number: 5, Hash: final}, 6: {Number: 6, Hash: final}, 50: {Number: 50, Hash: final}}
	watched := common.HexToAddress(receive)
	removed := settled(watched, 5, final)
	removed.Removed = true
	logs := []types.Log{
		settled(watched, 5, final),
		settled(watched, 50, final),                     // above the finalized block
		settled(watched, 6, other),                      // another block than the one the chain shows at that height
		settled(common.HexToAddress("0xbad"), 5, final), // not a watched receiver
		removed,
	}
	got, err := e.chain.outflows(ctx, logs, headers, invoices, 10)
	if err != nil || len(got) != 1 || got[0].Log.BlockNumber != 5 || got[0].InvoiceID != id {
		t.Fatalf("outflows %+v (%v); want only the final, canonical event of the watched receiver", got, err)
	}
	if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error { return RecordOutflows(ctx, tx, chaintest.ChainID, got) }); err != nil {
		t.Fatal(err)
	}
	// No node showed its transfer, so it stays unbooked and is read again, until a read finds the transfer.
	again, err := e.chain.outflows(ctx, logs, headers, invoices, 10)
	if err != nil || len(again) != 1 {
		t.Fatalf("an event recorded without its transfer was not read again: %+v (%v)", again, err)
	}
	again[0].Transfers = []types.Log{{Address: common.HexToAddress(invoices[watched].token), BlockNumber: 5,
		BlockHash: final, TxHash: common.HexToHash("0xfeed"), Index: 0, Data: amount,
		Topics: []common.Hash{transferTopic, common.BytesToHash(watched.Bytes()), again[0].Log.Topics[2]}}}
	if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error { return RecordOutflows(ctx, tx, chaintest.ChainID, again) }); err != nil {
		t.Fatal(err)
	}
	var index *int64
	var reason string
	if err := e.pool.QueryRow(ctx, "SELECT transfer_log_index, reconciliation_error FROM receiver_outflows").
		Scan(&index, &reason); err != nil || index == nil || *index != 0 || reason == "transfer_evidence_missing" {
		t.Fatalf("after the transfer was found: index %v, reason %q (%v)", index, reason, err)
	}
	if again, err := e.chain.outflows(ctx, logs, headers, invoices, 10); err != nil || len(again) != 0 {
		t.Fatalf("a complete event was read again: %+v (%v)", again, err)
	}
}
