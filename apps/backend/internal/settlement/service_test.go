package settlement

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/watcher"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The creator's profile wallet: settle pays it.
const wallet = "0x1111111111111111111111111111111111111111"

type env struct {
	anvil  *chaintest.Anvil
	pool   *pgxpool.Pool
	client *ethclient.Client
	token  string
	watch  *watcher.Chain
	ledger *ledger.Service
}

// setup runs Anvil with the real factory at its compiled address, Anvil's key as executor, a mock USDC, and a
// profile whose wallet is the recipient.
func setup(t *testing.T) env {
	t.Helper()
	ctx := context.Background()
	a := chaintest.Start(t)
	a.DeployFactory()
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
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id)
		INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		SELECT id, 'privy', 'w1', 'evm', $3 FROM p`, chaintest.ChainID, token, wallet)
	if err != nil {
		t.Fatal(err)
	}
	client, err := ethclient.Dial(a.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	e := env{anvil: a, pool: pool, client: client, token: token, watch: watcher.NewChain(pool, chaintest.ChainID, a.RPC),
		ledger: ledger.NewService(pool, ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: client}))}
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	return e
}

func (e env) signer(t *testing.T) *Signer {
	t.Helper()
	key, err := crypto.HexToECDSA(strings.TrimPrefix(chaintest.Key, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	return NewSigner(e.pool, key, map[uint64]*ethclient.Client{chaintest.ChainID: e.client})
}

// paidInvoice creates an invoice for 5 USDC with the address the API would compute, pays it 6 and runs the watcher
// and ledger until it is paid with a settlement intent.
func (e env) paidInvoice(t *testing.T) (id, receive string) {
	t.Helper()
	ctx := context.Background()
	now := e.anvil.Now()
	terms := address.Terms{InvoiceID: [32]byte(common.FromHex(fmt.Sprintf("0x%064x", 7))), Recipient: common.HexToAddress(wallet),
		Token: common.HexToAddress(e.token), Amount: big.NewInt(5000000), ExpiresAt: uint64(now + 3600),
		SettleDeadline: uint64(now + 3600 + 86400), IntendedChainID: chaintest.ChainID}
	addr, err := address.Receive(terms)
	if err != nil {
		t.Fatal(err)
	}
	id, receive = fmt.Sprintf("0x%064x", 7), strings.ToLower(common.Address(addr).Hex())
	_, err = e.pool.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT $1, profile_id, $2, 'evm', $3, 5000000, $4, $5, $6, 'evm_create2', $7, $8, 'k', decode(repeat('00', 32), 'hex')
		FROM profile_wallets`, id, chaintest.ChainID, e.token, terms.ExpiresAt, terms.SettleDeadline, wallet,
		strings.ToLower(common.Address(address.Factory).Hex()), receive)
	if err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(e.token, receive, "6000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if err := e.ledger.ProcessChain(ctx, chaintest.ChainID); err != nil {
		t.Fatal(err)
	}
	return id, receive
}

func (e env) nonce(t *testing.T) uint64 {
	t.Helper()
	n, err := e.client.NonceAt(context.Background(), common.HexToAddress(chaintest.Sender), nil)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func (e env) balance(t *testing.T, holder string) int64 {
	t.Helper()
	b, _, err := ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: e.client})(
		context.Background(), chaintest.ChainID, e.token, holder)
	if err != nil {
		t.Fatal(err)
	}
	return b.Int64()
}

func (e env) intent(t *testing.T, invoiceID string) (status, settlement, reason string) {
	t.Helper()
	var r *string
	err := e.pool.QueryRow(context.Background(), `SELECT si.status, i.settlement_status, si.reason
		FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id WHERE si.invoice_id = $1`, invoiceID).
		Scan(&status, &settlement, &r)
	if err != nil {
		t.Fatal(err)
	}
	if r != nil {
		reason = *r
	}
	return status, settlement, reason
}

func TestSettlesAPaidInvoiceOnce(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, receive := e.paidInvoice(t)
	if status, settlement, _ := e.intent(t, id); status != "pending" || settlement != "pending" {
		t.Fatalf("after paid: intent %s, invoice settlement %s", status, settlement)
	}
	before := e.nonce(t)
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if status, settlement, _ := e.intent(t, id); status != "confirmed" || settlement != "settled" {
		t.Fatalf("after the signer: intent %s, invoice settlement %s", status, settlement)
	}
	if got := e.balance(t, wallet); got != 5000000 {
		t.Fatalf("recipient got %d, want exactly 5000000", got)
	}
	if got := e.balance(t, receive); got != 1000000 {
		t.Fatalf("receive address keeps %d, want the 1000000 excess", got)
	}
	if got := e.nonce(t) - before; got != 2 {
		t.Fatalf("executor sent %d transactions, want 2 (deploy, settle)", got)
	}
	var receiver, owed, held int64
	if err := e.pool.QueryRow(ctx, `SELECT
		coalesce(sum(e.amount) FILTER (WHERE account = 'receiver'), 0)::bigint,
		-coalesce(sum(e.amount) FILTER (WHERE account = 'recipient_payable'), 0)::bigint,
		-coalesce(sum(e.amount) FILTER (WHERE account = 'payer_held'), 0)::bigint
		FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id WHERE x.invoice_id = $1`, id).
		Scan(&receiver, &owed, &held); err != nil || receiver != 1000000 || owed != 0 || held != 1000000 {
		t.Fatalf("ledger after settle: receiver %d owed %d held %d (%v); want 1000000, 0, 1000000", receiver, owed, held, err)
	}

	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if got := e.nonce(t) - before; got != 2 {
		t.Fatalf("a second run sent more: %d transactions", got)
	}
	_, err := e.pool.Exec(ctx, "INSERT INTO settlement_intents (invoice_id) VALUES ($1)", id)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("a second intent for the invoice: %v, want a unique violation", err)
	}
}

// Killed after saving the signed settle but before sending it: the restart sends those same bytes, once.
func TestRestartAfterSavingSendsTheSavedTransaction(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, _ := e.paidInvoice(t)
	before := e.nonce(t)
	crashing := e.signer(t)
	crashing.stopAfter = "save"
	if err := crashing.Run(ctx); !errors.Is(err, errStopped) {
		t.Fatalf("got %v", err)
	}
	var saved string
	if err := e.pool.QueryRow(ctx, "SELECT tx_hash FROM settlement_intents WHERE invoice_id = $1", id).Scan(&saved); err != nil {
		t.Fatal(err)
	}
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if status, _, _ := e.intent(t, id); status != "confirmed" || e.balance(t, wallet) != 5000000 {
		t.Fatalf("after the restart: intent %s, recipient %d", status, e.balance(t, wallet))
	}
	if got := e.nonce(t) - before; got != 2 {
		t.Fatalf("executor sent %d transactions, want 2 (deploy, the saved settle)", got)
	}
	if _, err := e.client.TransactionReceipt(ctx, common.HexToHash(saved)); err != nil {
		t.Fatalf("the saved settle %s was not the one mined: %v", saved, err)
	}
}

// Killed after sending the settle: the restart finds it mined and sends nothing.
func TestRestartAfterSendingSendsNothing(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, _ := e.paidInvoice(t)
	before := e.nonce(t)
	crashing := e.signer(t)
	crashing.stopAfter = "send"
	if err := crashing.Run(ctx); !errors.Is(err, errStopped) {
		t.Fatalf("got %v", err)
	}
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if status, _, _ := e.intent(t, id); status != "confirmed" || e.balance(t, wallet) != 5000000 {
		t.Fatalf("after the restart: intent %s, recipient %d", status, e.balance(t, wallet))
	}
	if got := e.nonce(t) - before; got != 2 {
		t.Fatalf("executor sent %d transactions, want 2", got)
	}
}

// Terms that no longer pay the profile wallet, or no longer compute the receive address, are refused: nothing sent.
func TestRefusesTermsThatDoNotMatch(t *testing.T) {
	for name, tamper := range map[string]string{
		"recipient is not the profile wallet": "UPDATE profile_wallets SET address = '0x2222222222222222222222222222222222222223'",
		"terms do not compute the stored receive address": `ALTER TABLE invoices DISABLE TRIGGER invoices_guard;
			UPDATE invoices SET expires_at = expires_at + 1;
			ALTER TABLE invoices ENABLE ALWAYS TRIGGER invoices_guard`,
	} {
		t.Run(name, func(t *testing.T) {
			e := setup(t)
			ctx := context.Background()
			id, receive := e.paidInvoice(t)
			before := e.nonce(t)
			if _, err := e.pool.Exec(ctx, tamper); err != nil {
				t.Fatal(err)
			}
			if err := e.signer(t).Run(ctx); err != nil {
				t.Fatal(err)
			}
			if status, _, reason := e.intent(t, id); status != "refused" || reason != name {
				t.Fatalf("intent %s (%s), want refused (%s)", status, reason, name)
			}
			if e.nonce(t) != before || e.balance(t, wallet) != 0 || e.balance(t, receive) != 6000000 {
				t.Fatal("something was sent")
			}
		})
	}
}
