package ledger

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"reflect"
	"testing"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/history/historytest"
	"github.com/forwend/forwend/apps/backend/internal/watcher"
	"github.com/jackc/pgx/v5/pgxpool"
)

type chainEnv struct {
	anvil   *chaintest.Anvil
	pool    *pgxpool.Pool
	token   string
	factory string // no code there until a test deploys the factory
	watch   *watcher.Chain
	service *Service
}

// The second RPC for balances is its own client to the same Anvil.
func newChainEnv(t *testing.T) chainEnv {
	t.Helper()
	ctx := context.Background()
	a := chaintest.Start(t)
	token := a.DeployToken()
	a.Mint(token, "1000000000")
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
	clients := map[uint64]*ethclient.Client{chaintest.ChainID: second}
	e := chainEnv{anvil: a, pool: pool, token: token, watch: watcher.NewChain(pool, chaintest.ChainID, a.RPC),
		factory: "0x2222222222222222222222222222222222222222",
		service: NewService(pool, BalanceFrom(clients), DeployedFrom(clients))}
	e.run(t)
	return e
}

func (e chainEnv) invoice(t *testing.T, n int, amount int64, expiresAt int64) (id, receive string) {
	t.Helper()
	id, receive = fmt.Sprintf("0x%064x", n), fmt.Sprintf("0x%040x", 0xa0+n)
	_, err := e.pool.Exec(context.Background(), `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT $1, id, $2, 'evm', $3, $4, $5::bigint, $5::bigint + 86400, '0x1111111111111111111111111111111111111111', 'evm_create2',
		    $7, $6, $1, decode(repeat('00', 32), 'hex') FROM profiles`,
		id, chaintest.ChainID, e.token, amount, expiresAt, receive, e.factory)
	if err != nil {
		t.Fatal(err)
	}
	return id, receive
}

// run is one worker round.
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

	history := []string{"invoice.detected by system", "invoice.partially_paid by system", "invoice.paid by system",
		`invoice.held by system {"amount": "1000000", "reason": "overpaid"}`, "invoice.settlement_queued by system"}
	if got := historytest.Events(t, e.pool, id); !reflect.DeepEqual(got, history) {
		t.Fatalf("history\n got %q\nwant %q", got, history)
	}
}

// D-15, D-45: the primary RPC calls the deposit final too early; the second RPC's finalized block lacks it.
func TestPaidNeedsTheSecondRPCToAgree(t *testing.T) {
	e := newChainEnv(t)
	id, receive := e.invoice(t, 1, 5000000, e.anvil.Now()+3600)
	e.anvil.Transfer(e.token, receive, "5000000")
	e.run(t) // seen, not final
	if _, err := e.pool.Exec(context.Background(), "UPDATE chain_transfers SET status = 'confirmed'"); err != nil {
		t.Fatal(err)
	}
	e.run(t)
	// Owed in full but the finalized balance does not hold it yet: money seen, not a partial payment (F145).
	want(t, "booked on the scan's word, not final in the balance", e.state(t, id),
		state{payment: Detected, refund: "none", receiver: 5000000, owed: 5000000})

	e.anvil.Mine(2)
	e.run(t)
	if got := e.state(t, id); got.payment != Paid {
		t.Fatalf("once the second RPC's finalized block holds it: %+v", got)
	}
}

// Expiry follows chain time.
func TestExpiryHoldsPartialAndLatePayments(t *testing.T) {
	e := newChainEnv(t)
	e.factory = e.anvil.DeployFactory() // the partial close reads it
	e.endpoint(t, "all", allEvents, true, false)
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

	// R-147: the part paid is held as expired, and the late deposit as late.
	for id, events := range map[string][]string{
		partial: {"1 invoice.partially_paid to all", "2 invoice.expired to all", "3 invoice.held expired to all",
			"4 invoice.held late to all"},
		unpaid: {"1 invoice.expired to all"},
	} {
		if got := historytest.Webhooks(t, e.pool, id); !reflect.DeepEqual(got, events) {
			t.Errorf("webhook events of %s\n got %q\nwant %q", id, got, events)
		}
	}
}

func TestOnTimeDepositPaysAfterExpiryFinalizes(t *testing.T) {
	e := newChainEnv(t)
	id, receive := e.invoice(t, 1, 5000000, e.anvil.Now()+1000)
	e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Wait(2000)
	e.anvil.Mine(3)
	e.run(t)
	want(t, "paid", e.state(t, id), state{payment: Paid, refund: "none", receiver: 5000000, owed: 5000000})
}

// D-26.
func TestLateFullPaymentIsHeldNotPaid(t *testing.T) {
	e := newChainEnv(t)
	e.endpoint(t, "all", allEvents, true, false)
	id, receive := e.invoice(t, 1, 5000000, e.anvil.Now()+1000)
	e.anvil.Wait(2000)
	e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Mine(2)
	e.run(t)
	want(t, "late full payment", e.state(t, id), state{payment: Expired, refund: "held", receiver: 5000000, held: 5000000})
	// Booked while the invoice was still open: held as late.
	events := []string{"1 invoice.expired to all", "2 invoice.held late to all"}
	if got := historytest.Webhooks(t, e.pool, id); !reflect.DeepEqual(got, events) {
		t.Fatalf("webhook events\n got %q\nwant %q", got, events)
	}
}

// D-27: a later deposit confirmed first waits for an earlier one still detected.
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

// A 0 balance could let an invoice expire with money in it.
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

// The read a partial close makes (R-130): the block time the factory deployed a receiver, once that block is final;
// 0 for a receiver not deployed; an error where no factory answers.
func TestDeployedFromReadsTheFactory(t *testing.T) {
	ctx := context.Background()
	a := chaintest.Start(t)
	factory := a.DeployFactory()
	terms := address.Terms{InvoiceID: [32]byte{1}, Recipient: [20]byte{0x11}, Token: [20]byte{0x22},
		Amount: big.NewInt(5), ExpiresAt: 1800000000, SettleDeadline: 1800086400, IntendedChainID: chaintest.ChainID}
	receiver, err := address.Receive(terms)
	if err != nil {
		t.Fatal(err)
	}
	// The refund authority deploys early, as a recovery does.
	a.AsAuthority(factory, "deploy((bytes32,address,address,uint256,uint64,uint64,uint256,uint256,uint256))",
		fmt.Sprintf("(0x%x,0x%x,0x%x,5,1800000000,1800086400,%d,0,0)", terms.InvoiceID, terms.Recipient, terms.Token,
			chaintest.ChainID))
	at := a.Now()
	client, err := ethclient.Dial(a.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	read := DeployedFrom(map[uint64]*ethclient.Client{chaintest.ChainID: client})
	deployed := fmt.Sprintf("0x%x", receiver)

	if got, err := read(ctx, chaintest.ChainID, factory, deployed); err != nil || got != 0 {
		t.Fatalf("before the deploy is final: %d, %v; want 0", got, err)
	}
	a.Mine(2)
	if got, err := read(ctx, chaintest.ChainID, factory, deployed); err != nil || got != uint64(at) {
		t.Fatalf("once final: %d, %v; want %d", got, err, at)
	}
	if got, err := read(ctx, chaintest.ChainID, factory, "0x3333333333333333333333333333333333333333"); err != nil ||
		got != 0 {
		t.Fatalf("not deployed: %d, %v; want 0", got, err)
	}
	if _, err := read(ctx, chaintest.ChainID, chaintest.Sender, deployed); err == nil {
		t.Fatal("no factory there: no error")
	}
}

func TestRecordedDepositTheChainDoesNotHoldIsNeverPaid(t *testing.T) {
	e := newChainEnv(t)
	id, receive := e.invoice(t, 70, 5000000, e.anvil.Now()+3600)
	e.anvil.Mine(3)
	e.run(t)
	if _, err := e.pool.Exec(t.Context(), `INSERT INTO chain_transfers (invoice_id,chain_id,chain_family,token_contract,
   tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
   SELECT id,chain_id,chain_family,token_contract,'0x' || repeat('70',32),0,'0x' || repeat('70',32),1,1,
   recipient_address,receive_address,5000000,'confirmed' FROM invoices WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := e.service.ProcessChain(t.Context(), chaintest.ChainID); err != nil {
			t.Fatal(err)
		}
	}
	var intents int
	if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM settlement_intents WHERE invoice_id = $1", id).Scan(&intents); err != nil || intents != 0 {
		t.Fatalf("settlement queued for money the chain does not hold: %d %v", intents, err)
	}
	if got := e.state(t, id); got.payment == Paid {
		t.Fatalf("a recorded deposit the finalized balance does not cover became paid: %+v at %s", got, receive)
	}
}

// R-230: the ledger books a settlement only as the amount less the option's fees, and each fee only as the option's
// own, whatever an outflow record says.
func TestSettlementAndFeesMustMatchTheTerms(t *testing.T) {
	e := newChainEnv(t)
	ctx := context.Background()
	outflow := func(id, receive, kind, destination string, amount int64, block uint64) {
		t.Helper()
		if _, err := e.pool.Exec(ctx, `INSERT INTO receiver_outflows (invoice_id, chain_id, receiver_address,
		    token_contract, kind, destination, amount, tx_hash, log_index, block_hash, block_number, block_time,
		    verified_block, transfer_log_index)
		    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 3, $8, $9, 1800000000, $9, $10)`, id, chaintest.ChainID, receive,
			e.token, kind, destination, amount, fmt.Sprintf("0x%064x", block), block, map[string]int{"settlement": 0,
				"network_fee": 1, "platform_fee": 2}[kind]); err != nil {
			t.Fatal(err)
		}
	}
	refused := func(id string) string {
		t.Helper()
		var got string
		if err := e.pool.QueryRow(ctx, `SELECT string_agg(kind || ' ' || reconciliation_error || ' ' ||
			(ledger_transaction_id IS NOT NULL), ', ' ORDER BY kind) FROM receiver_outflows WHERE invoice_id = $1`, id).
			Scan(&got); err != nil {
			t.Fatal(err)
		}
		return got
	}
	recipient := "0x1111111111111111111111111111111111111111"
	var invoices [2][2]string
	for n := range invoices {
		id, receive := fmt.Sprintf("0x%064x", n+1), fmt.Sprintf("0x%040x", 0xa1+n)
		if _, err := e.pool.Exec(ctx, `INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract,
		    amount, expires_at, settle_deadline, recipient_address, receive_method, factory_address, receive_address,
		    idempotency_key, request_hash, network_fee, platform_fee)
		    SELECT $1, id, $2, 'evm', $3, 5000000, $4::bigint, $4::bigint + 86400, $5, 'evm_create2', $6, $7, $1,
		        decode(repeat('00', 32), 'hex'), 30000, 20000 FROM profiles`,
			id, chaintest.ChainID, e.token, e.anvil.Now()+3600, recipient, e.factory, receive); err != nil {
			t.Fatal(err)
		}
		e.anvil.Transfer(e.token, receive, "5000000")
		invoices[n] = [2]string{id, receive}
	}
	e.anvil.Mine(2)
	e.run(t)
	after := uint64(e.anvil.Now()) // any block number after the deposits'
	// The full amount to the recipient, as if no fees were taken.
	outflow(invoices[0][0], invoices[0][1], "settlement", recipient, 5000000, after)
	// The net is right, but the network fee is not the option's.
	outflow(invoices[1][0], invoices[1][1], "settlement", recipient, 4950000, after+1)
	outflow(invoices[1][0], invoices[1][1], "network_fee", chaintest.Sender, 40000, after+1)
	e.run(t)
	if got := refused(invoices[0][0]); got != "settlement invalid_terms false" {
		t.Errorf("a settlement of the full amount: %s", got)
	}
	if got := refused(invoices[1][0]); got != "network_fee invalid_terms false, settlement  true" {
		t.Errorf("a network fee other than the terms': %s", got)
	}
}
