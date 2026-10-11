package ledger

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/watcher"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5/pgxpool"
)

type chainEnv struct {
	anvil   *chaintest.Anvil
	pool    *pgxpool.Pool
	token   string
	watch   *watcher.Chain
	service *Service
}

// newChainEnv runs Anvil with a mock USDC, a migrated database and a scanned chain. The second RPC for balances is
// its own client to the same Anvil.
func newChainEnv(t *testing.T) chainEnv {
	t.Helper()
	ctx := context.Background()
	a := chaintest.Start(t)
	token := a.DeployToken()
	a.Mint(token, "1000000000")
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
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id)
		INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u`, chaintest.ChainID, token)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ethclient.Dial(a.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(second.Close)
	e := chainEnv{anvil: a, pool: pool, token: token, watch: watcher.NewChain(pool, chaintest.ChainID, a.RPC),
		service: NewService(pool, BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: second}))}
	e.run(t)
	return e
}

// invoice adds an invoice for amount, paid at a receive address made from n, expiring at expiresAt.
func (e chainEnv) invoice(t *testing.T, n int, amount int64, expiresAt int64) (id, receive string) {
	t.Helper()
	id, receive = fmt.Sprintf("0x%064x", n), fmt.Sprintf("0x%040x", 0xa0+n)
	_, err := e.pool.Exec(context.Background(), `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT $1, id, $2, 'evm', $3, $4, $5::bigint, $5::bigint + 86400, '0x1111111111111111111111111111111111111111', 'evm_create2',
		    '0x2222222222222222222222222222222222222222', $6, $1, decode(repeat('00', 32), 'hex') FROM profiles`,
		id, chaintest.ChainID, e.token, amount, expiresAt, receive)
	if err != nil {
		t.Fatal(err)
	}
	return id, receive
}

// run is one worker round: scan the chain, then process its invoices.
func (e chainEnv) run(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if err := e.service.ProcessChain(ctx, chaintest.ChainID); err != nil {
		t.Fatal(err)
	}
}

type state struct {
	payment, refund      string
	receiver, owed, held int64
}

func (e chainEnv) state(t *testing.T, id string) state {
	t.Helper()
	var s state
	err := e.pool.QueryRow(context.Background(), `
		SELECT i.payment_status, i.refund_status,
		       coalesce(sum(e.amount) FILTER (WHERE e.account = 'receiver'), 0)::bigint,
		       -coalesce(sum(e.amount) FILTER (WHERE e.account = 'recipient_payable'), 0)::bigint,
		       -coalesce(sum(e.amount) FILTER (WHERE e.account = 'payer_held'), 0)::bigint
		FROM invoices i LEFT JOIN ledger_transactions t ON t.invoice_id = i.id
		LEFT JOIN ledger_entries e ON e.transaction_id = t.id WHERE i.id = $1
		GROUP BY i.payment_status, i.refund_status`, id).Scan(&s.payment, &s.refund, &s.receiver, &s.owed, &s.held)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func want(t *testing.T, step string, got, want state) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: got %+v, want %+v", step, got, want)
	}
}

func TestDepositsMoveThePaymentStatus(t *testing.T) {
	e := newChainEnv(t)
	id, receive := e.invoice(t, 1, 5000000, e.anvil.Now()+3600)

	e.anvil.Transfer(e.token, receive, "3000000")
	e.run(t)
	want(t, "seen, not final", e.state(t, id), state{payment: Detected, refund: "none"})

	e.anvil.Mine(2)
	e.run(t)
	want(t, "3 of 5 final", e.state(t, id), state{payment: PartiallyPaid, refund: "none", receiver: 3000000, owed: 3000000})

	e.anvil.Transfer(e.token, receive, "3000000")
	e.anvil.Mine(2)
	e.run(t)
	want(t, "6 of 5 final", e.state(t, id), state{payment: Paid, refund: "held", receiver: 6000000, owed: 5000000, held: 1000000})

	e.run(t)
	want(t, "run again", e.state(t, id), state{payment: Paid, refund: "held", receiver: 6000000, owed: 5000000, held: 1000000})
}

// A deposit the primary RPC calls final too early (a lie or a bug) never makes the invoice paid: the second RPC
// reads the balance at its own finalized block, which doesn't hold the deposit yet (D-15, D-45).
func TestPaidNeedsTheSecondRPCToAgree(t *testing.T) {
	e := newChainEnv(t)
	id, receive := e.invoice(t, 1, 5000000, e.anvil.Now()+3600)
	e.anvil.Transfer(e.token, receive, "5000000")
	e.run(t) // seen, not final
	if _, err := e.pool.Exec(context.Background(), "UPDATE chain_transfers SET status = 'confirmed'"); err != nil {
		t.Fatal(err)
	}
	e.run(t)
	want(t, "booked on the primary's word, not final on the second RPC", e.state(t, id),
		state{payment: PartiallyPaid, refund: "none", receiver: 5000000, owed: 5000000})

	e.anvil.Mine(2)
	e.run(t)
	if got := e.state(t, id); got.payment != Paid {
		t.Fatalf("once the second RPC's finalized block holds it: %+v", got)
	}
}

// Expiry follows chain time: a partial payment is then held for the payer, and a late deposit is held too.
func TestExpiryHoldsPartialAndLatePayments(t *testing.T) {
	e := newChainEnv(t)
	expires := e.anvil.Now() + 1000
	partial, receive := e.invoice(t, 1, 5000000, expires)
	unpaid, _ := e.invoice(t, 2, 5000000, expires)

	e.anvil.Transfer(e.token, receive, "2000000")
	e.anvil.Mine(2)
	e.run(t)
	want(t, "2 of 5 before expiry", e.state(t, partial), state{payment: PartiallyPaid, refund: "none", receiver: 2000000, owed: 2000000})

	e.anvil.Wait(2000)
	e.anvil.Mine(3) // a finalized block is now past expiresAt
	e.run(t)
	want(t, "expired", e.state(t, partial), state{payment: ExpiredPartiallyPaid, refund: "held", receiver: 2000000, held: 2000000})
	want(t, "expired unpaid", e.state(t, unpaid), state{payment: Expired, refund: "none"})

	e.anvil.Transfer(e.token, receive, "1000000") // late: never owed to the creator
	e.anvil.Mine(2)
	e.run(t)
	want(t, "late deposit", e.state(t, partial), state{payment: ExpiredPartiallyPaid, refund: "held", receiver: 3000000, held: 3000000})
}

// A deposit made in time but completing the amount pays the invoice even if its block is final after expiry.
func TestOnTimeDepositPaysAfterExpiryFinalizes(t *testing.T) {
	e := newChainEnv(t)
	id, receive := e.invoice(t, 1, 5000000, e.anvil.Now()+1000)
	e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Wait(2000)
	e.anvil.Mine(3)
	e.run(t)
	want(t, "paid", e.state(t, id), state{payment: Paid, refund: "none", receiver: 5000000, owed: 5000000})
}

// A full payment that arrives after expiresAt never pays the invoice: it is held for the payer (D-26).
func TestLateFullPaymentIsHeldNotPaid(t *testing.T) {
	e := newChainEnv(t)
	id, receive := e.invoice(t, 1, 5000000, e.anvil.Now()+1000)
	e.anvil.Wait(2000)
	e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Mine(2)
	e.run(t)
	want(t, "late full payment", e.state(t, id), state{payment: Expired, refund: "held", receiver: 5000000, held: 5000000})
}

// D-27: deposits are booked in chain order, so a later deposit confirmed first waits for an earlier one still
// detected, and the excess is held for the later payer.
func TestDepositsBookInChainOrder(t *testing.T) {
	e := newChainEnv(t)
	ctx := context.Background()
	id, receive := e.invoice(t, 1, 5000000, e.anvil.Now()+3600)
	first := e.anvil.Transfer(e.token, receive, "3000000")
	later := e.anvil.Transfer(e.token, receive, "3000000")
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE chain_transfers SET status = 'confirmed' WHERE tx_hash = $1", later); err != nil {
		t.Fatal(err)
	}
	if err := e.service.ProcessChain(ctx, chaintest.ChainID); err != nil {
		t.Fatal(err)
	}
	want(t, "later one confirmed first", e.state(t, id), state{payment: Detected, refund: "none"})

	if _, err := e.pool.Exec(ctx, "UPDATE chain_transfers SET status = 'confirmed' WHERE tx_hash = $1", first); err != nil {
		t.Fatal(err)
	}
	e.anvil.Mine(2)
	e.run(t)
	var held string
	if err := e.pool.QueryRow(ctx, `SELECT ct.tx_hash FROM ledger_entries le JOIN ledger_transactions lt ON lt.id = le.transaction_id
		JOIN chain_transfers ct ON ct.id = lt.chain_transfer_id WHERE le.account = 'payer_held'`).Scan(&held); err != nil || held != later {
		t.Fatalf("held from %s (%v), want the later deposit %s", held, err, later)
	}
}

// An empty balanceOf answer (no contract at that address and block) is an error, never a balance of 0 that could let
// an invoice expire with money in it.
func TestEmptyBalanceAnswerIsAnError(t *testing.T) {
	e := newChainEnv(t)
	client := ethclient.NewClient(e.anvil.RPC)
	block, err := client.BlockNumber(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, err = BalanceAt(context.Background(), client, chaintest.ChainID, "0x00000000000000000000000000000000000000c0",
		"0x1111111111111111111111111111111111111111", block)
	if !errors.Is(err, ErrNoToken) {
		t.Fatalf("got %v, want ErrNoToken", err)
	}
}
