package watcher

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	ours     = "0x00000000000000000000000000000000000000b1" // another profile's wallet
	outsider = "0x00000000000000000000000000000000000000cc"
	zero     = "0x0000000000000000000000000000000000000000"
)

// addWallets gives each address its own profile.
func addWallets(t *testing.T, pool *pgxpool.Pool, addresses ...string) {
	t.Helper()
	for _, a := range addresses {
		if _, err := pool.Exec(context.Background(), `
			WITH p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM users RETURNING id)
			INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
			SELECT id, 'privy', $1, 'evm', $1 FROM p`, a); err != nil {
			t.Fatal(err)
		}
	}
}

// walletRows lists the recorded wallet transfers in chain order as "wallet direction counterparty amount status".
func (e env) walletRows(t *testing.T) []string {
	t.Helper()
	rows, err := e.pool.Query(context.Background(), `SELECT concat_ws(' ', wallet_address, direction, counterparty,
		amount, status) FROM wallet_transfers ORDER BY block_number, log_index, direction`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var row string
		if err := rows.Scan(&row); err != nil {
			t.Fatal(err)
		}
		out = append(out, row)
	}
	return out
}

// Sender and ours are profile wallets. Every enabled-token transfer from or to them is recorded, once per wallet
// side: a transfer between them is out for Sender and in for ours. Recording reaches back RescanDepth blocks below
// the finalized block, so setup's mint to Sender (from the zero address) counts as received.
func TestWalletTransfersAreRecordedInAndOut(t *testing.T) {
	e := setup(t)
	addWallets(t, e.pool, chaintest.Sender, ours)
	lookalike := e.anvil.DeployToken() // listed but disabled: its transfers are ignored
	e.anvil.Mint(lookalike, "100000000")
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals,
		enabled) VALUES ($1, 'evm', $2, 'OLD', 6, false)`, chaintest.ChainID, lookalike); err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(lookalike, ours, "5")
	e.anvil.Transfer(e.token, ours, "2000000")
	e.anvil.Transfer(e.token, outsider, "1000000")
	e.scan(t)
	sender := chaintest.Sender
	mint := sender + " in " + zero + " 100000000 confirmed"
	sides := []string{ours + " in " + sender + " 2000000 ", sender + " out " + ours + " 2000000 ",
		sender + " out " + outsider + " 1000000 "}
	want := []string{mint, sides[0] + "detected", sides[1] + "detected", sides[2] + "detected"}
	if got := e.walletRows(t); !reflect.DeepEqual(got, want) {
		t.Fatalf("after the transfers:\n got %q\nwant %q", got, want)
	}

	e.anvil.Mine(2) // both blocks become final
	e.scan(t)
	want = []string{mint, sides[0] + "confirmed", sides[1] + "confirmed", sides[2] + "confirmed"}
	if got := e.walletRows(t); !reflect.DeepEqual(got, want) {
		t.Fatalf("once final:\n got %q\nwant %q", got, want)
	}
}

// A wallet transfer follows the deposit reorg rules: reorged when its block is replaced, a new row when the same
// transaction is mined again, confirmed once final, and scanning again changes nothing.
func TestWalletTransferReorg(t *testing.T) {
	e := setup(t)
	addWallets(t, e.pool, ours)
	tx := e.anvil.Transfer(e.token, ours, "2000000")
	raw := e.anvil.RawTx(tx)
	row := ours + " in " + chaintest.Sender + " 2000000 "
	e.scan(t)
	if got := e.walletRows(t); !reflect.DeepEqual(got, []string{row + "detected"}) {
		t.Fatalf("after the transfer: %q", got)
	}

	e.anvil.Reorg(1) // the block with the transfer is replaced by an empty one
	e.scan(t)
	if got := e.walletRows(t); !reflect.DeepEqual(got, []string{row + "reorged"}) {
		t.Fatalf("after the reorg: %q", got)
	}

	e.anvil.SendRaw(raw) // mined again in another block: same tx hash and log index, new row
	e.scan(t)
	if got := e.walletRows(t); !reflect.DeepEqual(got, []string{row + "reorged", row + "detected"}) {
		t.Fatalf("after the transaction is mined again: %q", got)
	}

	e.anvil.Mine(2)
	e.scan(t)
	e.scan(t)
	var hashes int
	if err := e.pool.QueryRow(context.Background(), "SELECT count(*) FROM wallet_transfers WHERE tx_hash = $1", tx).
		Scan(&hashes); err != nil || hashes != 2 {
		t.Fatalf("%d rows for %s, %v; want the reorged and the re-mined one", hashes, tx, err)
	}
	if got := e.walletRows(t); !reflect.DeepEqual(got, []string{row + "reorged", row + "confirmed"}) {
		t.Fatalf("once final: %q", got)
	}
}

// A token disabled while one of its wallet transfers is still detected: that row still confirms by the normal rules
// and stops holding the scan's start; the token's later transfers are not recorded.
func TestDetectedTransferOfADisabledTokenStillConfirms(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	addWallets(t, e.pool, ours)
	e.anvil.Transfer(e.token, ours, "2000000")
	e.scan(t)
	row := ours + " in " + chaintest.Sender + " 2000000 "
	if got := e.walletRows(t); !reflect.DeepEqual(got, []string{row + "detected"}) {
		t.Fatalf("after the transfer: %q", got)
	}

	if _, err := e.pool.Exec(ctx, "UPDATE tokens SET enabled = false WHERE contract = $1", e.token); err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(e.token, ours, "1000000") // after the token is disabled: not recorded
	e.anvil.Mine(2 * RescanDepth)
	e.scan(t)
	if got := e.walletRows(t); !reflect.DeepEqual(got, []string{row + "confirmed"}) {
		t.Fatalf("once final: %q", got)
	}
	from, err := e.chain.start(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var finalized uint64
	if err := e.pool.QueryRow(ctx, "SELECT last_finalized_block FROM chain_cursors").Scan(&finalized); err != nil {
		t.Fatal(err)
	}
	if want := finalized + 1 - RescanDepth; from != want {
		t.Fatalf("scan starts at %d, want %d (RescanDepth below the finalized block %d)", from, want, finalized)
	}
}

func TestAddressListsAreSplitForTheNode(t *testing.T) {
	e := setup(t)
	addWallets(t, e.pool, chaintest.Sender, ours)
	const second = "0x00000000000000000000000000000000000000ab"
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('02', 32), profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, $1, 'key-2', request_hash
		FROM invoices`, second); err != nil {
		t.Fatal(err)
	}
	defer func(limit int) { topicLimit = limit }(topicLimit)
	topicLimit = 1
	proxy := e.anvil.Proxy()
	proxy.Fail(func(call chaintest.Call) chaintest.Fault {
		if call.Method == "eth_getLogs" && strings.Count(string(call.Params[0]), "0x000000000000000000000000") > topicLimit {
			return chaintest.TooManyTopics
		}
		return chaintest.Forward
	})
	client, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	e.chain = NewChain(e.pool, chaintest.ChainID, client)

	first := e.anvil.Transfer(e.token, receive, "5000000")
	next := e.anvil.Transfer(e.token, second, "5000000")
	e.anvil.Transfer(e.token, ours, "2000000")
	e.scan(t)
	if got, n := e.rows(t); n != 2 || got[first] == nil || got[next] == nil {
		t.Fatalf("deposits to two receive addresses: %v", got)
	}
	if got := e.walletRows(t); len(got) != 5 { // the mint to Sender, and per transfer one side for each wallet involved
		t.Fatalf("wallet transfers: %q", got)
	}
}
