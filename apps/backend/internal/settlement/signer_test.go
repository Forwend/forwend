package settlement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/watcher"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
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
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id),
		     b AS (INSERT INTO profile_billing_details (profile_id, name, address, country, contact_email)
		           SELECT id, 'Alice', 'Main St 1', 'DE', 'alice@example.com' FROM p)
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
	clients := map[uint64]*ethclient.Client{chaintest.ChainID: e.client}
	return NewSigner(e.pool, key, clients, clients)
}

// paidInvoice creates an invoice for 5 USDC with the address the API would compute, pays it 6 and runs the watcher
// and ledger until it is paid with a settlement intent.
func (e env) paidInvoice(t *testing.T) (id, receive string) {
	t.Helper()
	return e.pay(t, 7)
}

// pay is paidInvoice for the invoice with ID n.
func (e env) pay(t *testing.T, n int) (id, receive string) {
	t.Helper()
	ctx := context.Background()
	id, receive = e.create(t, n)
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

// create stores the invoice with ID n for 5 USDC, open for an hour, with the address the API would compute.
func (e env) create(t *testing.T, n int) (id, receive string) {
	t.Helper()
	ctx := context.Background()
	now := e.anvil.Now()
	terms := address.Terms{InvoiceID: [32]byte(common.FromHex(fmt.Sprintf("0x%064x", n))), Recipient: common.HexToAddress(wallet),
		Token: common.HexToAddress(e.token), Amount: big.NewInt(5000000), ExpiresAt: uint64(now + 3600),
		SettleDeadline: uint64(now + 3600 + 86400), IntendedChainID: chaintest.ChainID}
	addr, err := address.Receive(terms)
	if err != nil {
		t.Fatal(err)
	}
	id, receive = fmt.Sprintf("0x%064x", n), strings.ToLower(common.Address(addr).Hex())
	_, err = e.pool.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT $1, profile_id, $2, 'evm', $3, 5000000, $4, $5, $6, 'evm_create2', $7, $8, $9, decode(repeat('00', 32), 'hex')
		FROM profile_wallets`, id, chaintest.ChainID, e.token, terms.ExpiresAt, terms.SettleDeadline, wallet,
		strings.ToLower(common.Address(address.Factory).Hex()), receive, fmt.Sprintf("k%d", n))
	if err != nil {
		t.Fatal(err)
	}
	return id, receive
}

// final mines past the finalized block (Anvil: latest - 2) and runs the signer, which confirms what is now final.
func (e env) final(t *testing.T, s *Signer) {
	t.Helper()
	e.anvil.Mine(2)
	if err := s.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
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

// wait is the wait kind the signer stored with the invoice's intent, "" when none.
func (e env) wait(t *testing.T, invoiceID string) string {
	t.Helper()
	var w *string
	if err := e.pool.QueryRow(context.Background(), "SELECT wait FROM settlement_intents WHERE invoice_id = $1",
		invoiceID).Scan(&w); err != nil {
		t.Fatal(err)
	}
	if w == nil {
		return ""
	}
	return *w
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
	if status, settlement, _ := e.intent(t, id); status != "sent" || settlement != "pending" {
		t.Fatalf("settle mined but not final: intent %s, invoice settlement %s; want sent, pending", status, settlement)
	}
	e.final(t, e.signer(t))
	if status, settlement, _ := e.intent(t, id); status != "confirmed" || settlement != "settled" {
		t.Fatalf("after finality: intent %s, invoice settlement %s", status, settlement)
	}
	// The owner hears of each change once, from the transaction that made it (R-80): paid, the 1 USDC above the amount
	// held for the payer, then the settlement.
	e.final(t, e.signer(t))
	var kinds string
	if err := e.pool.QueryRow(ctx, `SELECT string_agg(kind, ',' ORDER BY id) FROM outbox_events WHERE invoice_id = $1`,
		id).Scan(&kinds); err != nil || kinds != "invoice.paid,invoice.held,invoice.settled" {
		t.Fatalf("outbox events %q (%v), want invoice.paid,invoice.held,invoice.settled", kinds, err)
	}
	hash := e.settlementTxHash(t, id)
	if r, err := e.client.TransactionReceipt(ctx, common.HexToHash(hash)); err != nil || r.Status != types.ReceiptStatusSuccessful {
		t.Fatalf("settlementTxHash %q: receipt %v (%v), want our successful settle", hash, r, err)
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
	e.final(t, e.signer(t))
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
	e.final(t, e.signer(t))
	if status, _, _ := e.intent(t, id); status != "confirmed" || e.balance(t, wallet) != 5000000 {
		t.Fatalf("after the restart: intent %s, recipient %d", status, e.balance(t, wallet))
	}
	if got := e.nonce(t) - before; got != 2 {
		t.Fatalf("executor sent %d transactions, want 2", got)
	}
}

// R-54: the worker and the signer are down while the payer pays (or after the worker saw the payment but before it was
// final) and until after the checkout closed. New processes book it from the saved cursor, as paid and not late,
// since it was mined before the close, and settle it exactly once.
func TestPaidWhileTheWorkerWasDownSettlesAfterARestart(t *testing.T) {
	for name, seenBeforeTheStop := range map[string]bool{"never seen": false, "seen, not final": true} {
		t.Run(name, func(t *testing.T) {
			e := setup(t)
			ctx := context.Background()
			id, receive := e.create(t, 7)
			e.anvil.Transfer(e.token, receive, "5000000")
			if seenBeforeTheStop {
				if err := e.watch.Scan(ctx); err != nil { // its block is above the finalized one: detected only
					t.Fatal(err)
				}
				var status string
				if err := e.pool.QueryRow(ctx, "SELECT status FROM chain_transfers WHERE invoice_id = $1", id).
					Scan(&status); err != nil || status != "detected" {
					t.Fatalf("before the stop: transfer %q (%v), want detected", status, err)
				}
			}
			// The processes are down: the chain goes on past the checkout's close.
			e.anvil.Wait(2 * 3600)
			e.anvil.Mine(3)

			before := e.nonce(t)
			client := map[uint64]*ethclient.Client{chaintest.ChainID: e.client}
			if err := watcher.NewChain(e.pool, chaintest.ChainID, e.anvil.RPC).Scan(ctx); err != nil {
				t.Fatal(err)
			}
			if err := ledger.NewService(e.pool, ledger.BalanceFrom(client)).ProcessChain(ctx, chaintest.ChainID); err != nil {
				t.Fatal(err)
			}
			var payment, refund string
			if err := e.pool.QueryRow(ctx, "SELECT payment_status, refund_status FROM invoices WHERE id = $1", id).
				Scan(&payment, &refund); err != nil {
				t.Fatal(err)
			}
			if payment != "paid" || refund != "none" {
				t.Fatalf("after the restart: payment %s, refund %s; want paid with nothing held", payment, refund)
			}
			if err := e.signer(t).Run(ctx); err != nil {
				t.Fatal(err)
			}
			e.final(t, e.signer(t))
			if status, settlement, _ := e.intent(t, id); status != "confirmed" || settlement != "settled" ||
				e.balance(t, wallet) != 5000000 {
				t.Fatalf("after the restart: intent %s, invoice %s, recipient %d", status, settlement, e.balance(t, wallet))
			}
			if got := e.nonce(t) - before; got != 2 {
				t.Fatalf("executor sent %d transactions, want 2 (deploy, settle)", got)
			}
		})
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

// A settle already sent is finished even if the database changed meanwhile: never "refused" while money moved.
func TestSentSettleIsFinishedEvenIfTheWalletChanged(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, _ := e.paidInvoice(t)
	crashing := e.signer(t)
	crashing.stopAfter = "send"
	if err := crashing.Run(ctx); !errors.Is(err, errStopped) {
		t.Fatalf("got %v", err)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE profile_wallets SET address = '0x2222222222222222222222222222222222222223'"); err != nil {
		t.Fatal(err)
	}
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	e.final(t, e.signer(t))
	if status, settlement, _ := e.intent(t, id); status != "confirmed" || settlement != "settled" || e.balance(t, wallet) != 5000000 {
		t.Fatalf("intent %s, invoice %s, recipient %d", status, settlement, e.balance(t, wallet))
	}
}

// A paused factory is a temporary condition: the intent waits and settles after unpausing.
func TestPausedFactoryIsRetried(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, _ := e.paidInvoice(t)
	factory := strings.ToLower(common.Address(address.Factory).Hex())
	e.anvil.AsAuthority(factory, "setPaused(bool)", "true")
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if status, _, reason := e.intent(t, id); status != "pending" || reason == "" || e.wait(t, id) != waitRetry ||
		e.balance(t, wallet) != 0 {
		t.Fatalf("while paused: intent %s (%s, wait %q), recipient %d; want pending with a reason and wait retry",
			status, reason, e.wait(t, id), e.balance(t, wallet))
	}
	e.anvil.AsAuthority(factory, "setPaused(bool)", "false")
	if _, err := e.pool.Exec(ctx, "UPDATE settlement_intents SET next_attempt_at = now()"); err != nil {
		t.Fatal(err)
	}
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	e.final(t, e.signer(t))
	if status, _, _ := e.intent(t, id); status != "confirmed" || e.balance(t, wallet) != 5000000 {
		t.Fatalf("after unpausing: intent %s, recipient %d", status, e.balance(t, wallet))
	}
}

// A saved settle whose nonce another transaction took is signed again, and settles once.
func TestNonceTakenByAnotherTransaction(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, _ := e.paidInvoice(t)
	crashing := e.signer(t)
	crashing.stopAfter = "save"
	if err := crashing.Run(ctx); !errors.Is(err, errStopped) {
		t.Fatalf("got %v", err)
	}
	e.anvil.Transfer(e.token, "0x00000000000000000000000000000000000000bb", "1") // takes the saved nonce
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if status, _, _ := e.intent(t, id); status != "sent" {
		t.Fatalf("nonce taken in a block that is not final: intent %s, want sent until it is", status)
	}
	e.final(t, e.signer(t))
	if status, _, reason := e.intent(t, id); status != "pending" || reason == "" {
		t.Fatalf("after its nonce was taken: intent %s (%s), want pending to sign again", status, reason)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE settlement_intents SET next_attempt_at = now()"); err != nil {
		t.Fatal(err)
	}
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	e.final(t, e.signer(t))
	if status, _, _ := e.intent(t, id); status != "confirmed" || e.balance(t, wallet) != 5000000 {
		t.Fatalf("intent %s, recipient %d", status, e.balance(t, wallet))
	}
}

// A tx_hash that is not this receiver's settle never confirms the settlement.
func TestForeignTxHashIsNotConfirmed(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, receive := e.paidInvoice(t)
	crashing := e.signer(t)
	crashing.stopAfter = "save"
	if err := crashing.Run(ctx); !errors.Is(err, errStopped) {
		t.Fatalf("got %v", err)
	}
	other := e.anvil.Transfer(e.token, "0x00000000000000000000000000000000000000bb", "1")
	if _, err := e.pool.Exec(ctx, "UPDATE settlement_intents SET tx_hash = $1", other); err != nil {
		t.Fatal(err)
	}
	if err := e.signer(t).Run(ctx); err == nil {
		t.Fatal("a foreign tx_hash was accepted")
	}
	if status, settlement, _ := e.intent(t, id); status == "confirmed" || settlement == "settled" || e.balance(t, receive) != 6000000 {
		t.Fatalf("intent %s, invoice %s, receiver %d", status, settlement, e.balance(t, receive))
	}
}

// settleOutside deploys and settles the receiver directly from the executor, not through our signer.
func (e env) settleOutside(t *testing.T, id, receive string) {
	t.Helper()
	var expires, deadline int64
	if err := e.pool.QueryRow(context.Background(), "SELECT expires_at, settle_deadline FROM invoices WHERE id = $1",
		id).Scan(&expires, &deadline); err != nil {
		t.Fatal(err)
	}
	terms := fmt.Sprintf("(%s,%s,%s,5000000,%d,%d,%d)", id, wallet, e.token, expires, deadline, chaintest.ChainID)
	e.anvil.Send(strings.ToLower(common.Address(address.Factory).Hex()),
		"deploy((bytes32,address,address,uint256,uint64,uint64,uint256))", terms)
	e.anvil.Send(receive, "settle()")
}

// A receiver settled outside our signer (e.g. by the refund authority after the deadline) still confirms the intent.
func TestExternallySettledIntentIsConfirmed(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, receive := e.paidInvoice(t)
	e.settleOutside(t, id, receive)
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if status, _, _ := e.intent(t, id); status != "pending" {
		t.Fatalf("settled outside but not final: intent %s, want pending", status)
	}
	e.final(t, e.signer(t))
	if status, settlement, _ := e.intent(t, id); status != "confirmed" || settlement != "settled" {
		t.Fatalf("intent %s, invoice %s; want confirmed and settled", status, settlement)
	}
}

// A stale attempt never moves an intent that went on: retry and refuse only change the status they loaded.
func TestStaleAttemptDoesNotOverwriteAConfirmedIntent(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, _ := e.paidInvoice(t)
	s := e.signer(t)
	var intentID int64
	if err := e.pool.QueryRow(ctx, "SELECT id FROM settlement_intents WHERE invoice_id = $1", id).Scan(&intentID); err != nil {
		t.Fatal(err)
	}
	stale, err := s.load(ctx, intentID) // loaded while pending
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	e.final(t, s)
	if err := s.retry(ctx, stale, "stale"); err != nil {
		t.Fatal(err)
	}
	if err := s.refuse(ctx, stale, "stale"); err != nil {
		t.Fatal(err)
	}
	if status, _, _ := e.intent(t, id); status != "confirmed" {
		t.Fatalf("stale attempt moved the intent to %s", status)
	}
}

// The signer works only on intents of chains it serves (enabled chains with an RPC).
func TestSignerSkipsChainsItDoesNotServe(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, _ := e.paidInvoice(t)
	key, err := crypto.HexToECDSA(strings.TrimPrefix(chaintest.Key, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	before := e.nonce(t)
	if err := NewSigner(e.pool, key, map[uint64]*ethclient.Client{}, map[uint64]*ethclient.Client{}).Run(ctx); err != nil {
		t.Fatalf("a chain it does not serve is not an error: %v", err)
	}
	if status, _, _ := e.intent(t, id); status != "pending" || e.nonce(t) != before {
		t.Fatalf("intent %s, nonce moved %v", status, e.nonce(t) != before)
	}
}

// A settle that a reorg drops before it is final is not booked; the saved bytes are sent again and booked once final.
func TestSettleDroppedByReorgIsSentAgain(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, receive := e.paidInvoice(t)
	s := e.signer(t)
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	var saved string
	if err := e.pool.QueryRow(ctx, "SELECT tx_hash FROM settlement_intents WHERE invoice_id = $1", id).Scan(&saved); err != nil {
		t.Fatal(err)
	}
	e.anvil.Reorg(1) // the block with the settle is replaced: the payout is gone
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	if status, settlement, _ := e.intent(t, id); status != "sent" || settlement != "pending" {
		t.Fatalf("after the reorg: intent %s, invoice %s; want sent, pending", status, settlement)
	}
	e.final(t, s)
	if status, settlement, _ := e.intent(t, id); status != "confirmed" || settlement != "settled" {
		t.Fatalf("once final: intent %s, invoice %s", status, settlement)
	}
	if e.balance(t, wallet) != 5000000 || e.balance(t, receive) != 1000000 {
		t.Fatalf("recipient %d, receiver %d; want 5000000 and the 1000000 excess", e.balance(t, wallet), e.balance(t, receive))
	}
	if _, err := e.client.TransactionReceipt(ctx, common.HexToHash(saved)); err != nil {
		t.Fatalf("the saved settle %s was not the one mined again: %v", saved, err)
	}
}

// After the settle deadline only the refund authority may settle: the signer sends nothing, waits, and records the
// authority's settle once it is final.
func TestAfterTheDeadlineTheSignerWaitsForTheRefundAuthority(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, receive := e.paidInvoice(t)
	e.anvil.Wait(3600 + 86400 + 60)
	e.anvil.Mine(1)
	before := e.nonce(t)
	s := e.signer(t)
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	if status, _, reason := e.intent(t, id); status != "pending" || !strings.Contains(reason, "refund authority") || e.nonce(t) != before {
		t.Fatalf("after the deadline: intent %s (%s), sent %v; want pending, waiting, nothing sent", status, reason, e.nonce(t) != before)
	}
	var expires, deadline int64
	if err := e.pool.QueryRow(ctx, "SELECT expires_at, settle_deadline FROM invoices WHERE id = $1", id).Scan(&expires, &deadline); err != nil {
		t.Fatal(err)
	}
	e.anvil.AsAuthority(strings.ToLower(common.Address(address.Factory).Hex()),
		"deploy((bytes32,address,address,uint256,uint64,uint64,uint256))",
		fmt.Sprintf("(%s,%s,%s,5000000,%d,%d,%d)", id, wallet, e.token, expires, deadline, chaintest.ChainID))
	e.anvil.AsAuthority(receive, "settle()")
	if _, err := e.pool.Exec(ctx, "UPDATE settlement_intents SET next_attempt_at = now()"); err != nil {
		t.Fatal(err)
	}
	e.final(t, s)
	if status, settlement, _ := e.intent(t, id); status != "confirmed" || settlement != "settled" || e.balance(t, wallet) != 5000000 {
		t.Fatalf("after the authority settled: intent %s, invoice %s, recipient %d", status, settlement, e.balance(t, wallet))
	}
	if e.nonce(t) != before {
		t.Fatal("the executor sent something after the deadline")
	}
}

// settlementTxHash is the hash GET /v1/invoices/{id} shows; "" is null.
func (e env) settlementTxHash(t *testing.T, invoiceID string) string {
	t.Helper()
	inv, err := invoice.NewService(e.pool).Get(context.Background(), invoiceID)
	if err != nil {
		t.Fatal(err)
	}
	return inv.SettlementTxHash
}

// Our settle is saved but reverts or never mines, and the refund authority settles after the deadline: the intent
// is confirmed and booked once, with no settlement tx hash, since our transaction did not settle.
func TestSettledByTheRefundAuthorityAfterOurSettleFailedHasNoTxHash(t *testing.T) {
	for name, send := range map[string]bool{"reverted": true, "never mined": false} {
		t.Run(name, func(t *testing.T) {
			e := setup(t)
			ctx := context.Background()
			id, receive := e.paidInvoice(t)
			crashing := e.signer(t)
			crashing.stopAfter = "save"
			if err := crashing.Run(ctx); !errors.Is(err, errStopped) {
				t.Fatalf("got %v", err)
			}
			e.anvil.Wait(3600 + 86400 + 60)
			if send { // past the deadline only the refund authority may settle: ours reverts
				var saved string
				var raw []byte
				if err := e.pool.QueryRow(ctx, "SELECT tx_hash, raw_tx FROM settlement_intents WHERE invoice_id = $1",
					id).Scan(&saved, &raw); err != nil {
					t.Fatal(err)
				}
				e.anvil.SendRaw(hexutil.Encode(raw))
				if r, err := e.client.TransactionReceipt(ctx, common.HexToHash(saved)); err != nil || r.Status != types.ReceiptStatusFailed {
					t.Fatalf("our settle: receipt %v (%v), want reverted", r, err)
				}
			}
			e.anvil.AsAuthority(receive, "settle()")
			s := e.signer(t)
			if err := s.Run(ctx); err != nil {
				t.Fatal(err)
			}
			e.final(t, s)
			if status, settlement, _ := e.intent(t, id); status != "confirmed" || settlement != "settled" || e.balance(t, wallet) != 5000000 {
				t.Fatalf("intent %s, invoice %s, recipient %d", status, settlement, e.balance(t, wallet))
			}
			if hash := e.settlementTxHash(t, id); hash != "" {
				t.Fatalf("settlementTxHash %s, want null: our settle did not settle the receiver", hash)
			}
			var booked int
			if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM ledger_transactions WHERE invoice_id = $1 AND kind = 'settlement'",
				id).Scan(&booked); err != nil || booked != 1 {
				t.Fatalf("settlement booked %d times (%v), want once", booked, err)
			}
		})
	}
}

// An RPC that stops answering can't stall the signer: each intent's attempt has a deadline.
func TestHangingRPCDoesNotStallTheSigner(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	e.paidInvoice(t)
	stop := make(chan struct{})
	hang := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select { // never answers; returns when the test ends so Close doesn't wait forever
		case <-r.Context().Done():
		case <-stop:
		}
	}))
	defer hang.Close()
	defer close(stop)
	client, err := ethclient.Dial(hang.URL)
	if err != nil {
		t.Fatal(err)
	}
	key, err := crypto.HexToECDSA(strings.TrimPrefix(chaintest.Key, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	clients := map[uint64]*ethclient.Client{chaintest.ChainID: client}
	s := NewSigner(e.pool, key, clients, clients)
	s.attemptTimeout = 300 * time.Millisecond
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("a hanging RPC was not reported")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run is stuck on a hanging RPC")
	}
}

// signerVia is a signer whose RPC is url, such as a proxy in front of Anvil.
func (e env) signerVia(t *testing.T, url string) *Signer {
	t.Helper()
	client, err := ethclient.Dial(url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	s := e.signer(t)
	s.clients = map[uint64]*ethclient.Client{chaintest.ChainID: client}
	return s
}

// param is a proxied call's i-th parameter as lowercase JSON.
func param(c chaintest.Call, i int) string {
	if i >= len(c.Params) {
		return ""
	}
	return strings.ToLower(string(c.Params[i]))
}

func (e env) dueNow(t *testing.T) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), "UPDATE settlement_intents SET next_attempt_at = now()"); err != nil {
		t.Fatal(err)
	}
}

// A node that has not seen the new receiver shows no code there and estimates settle as a call to an empty address,
// 21,064 gas, which runs out. The signer sends no settle until the node shows the receiver's code, and never gives
// settle less than SettleGasFloor.
func TestSettleWaitsForTheReceiverCodeAndNeverUnderestimatesGas(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, receive := e.paidInvoice(t)
	proxy := e.anvil.Proxy()
	lag := func(hidden int) { // the first hidden eth_getCode calls at the receiver say no code; every estimate is low
		proxy.Stale(func(c chaintest.Call) json.RawMessage {
			switch {
			case c.Method == "eth_getCode" && strings.Contains(param(c, 0), receive) && hidden > 0:
				hidden--
				return json.RawMessage(`"0x"`)
			case c.Method == "eth_estimateGas" && strings.Contains(param(c, 0), receive):
				return json.RawMessage(`"0x5248"`)
			}
			return nil
		})
	}
	lag(1 << 30)
	before := e.nonce(t)
	s := e.signerVia(t, proxy.URL)
	s.codeWait = time.Second
	if err := s.Run(ctx); err == nil {
		t.Fatal("the signer went on while the RPC showed no code at the receiver")
	}
	if status, _, _ := e.intent(t, id); status != "pending" || e.nonce(t)-before != 1 || e.balance(t, wallet) != 0 {
		t.Fatalf("intent %s, executor sent %d, recipient %d; want pending after the deploy alone", status,
			e.nonce(t)-before, e.balance(t, wallet))
	}

	lag(2)
	e.dueNow(t)
	s = e.signerVia(t, proxy.URL)
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	var saved string
	if err := e.pool.QueryRow(ctx, "SELECT tx_hash FROM settlement_intents WHERE invoice_id = $1", id).Scan(&saved); err != nil {
		t.Fatal(err)
	}
	settle, _, err := e.client.TransactionByHash(ctx, common.HexToHash(saved))
	if err != nil {
		t.Fatal(err)
	}
	r, err := e.client.TransactionReceipt(ctx, common.HexToHash(saved))
	if err != nil || r.Status != types.ReceiptStatusSuccessful || settle.Gas() < SettleGasFloor {
		t.Fatalf("settle with gas %d: receipt %v (%v); want success with at least %d", settle.Gas(), r, err, SettleGasFloor)
	}
	t.Logf("settle used %d gas, limit %d", r.GasUsed, settle.Gas())
	e.final(t, s)
	if status, _, _ := e.intent(t, id); status != "confirmed" || e.balance(t, wallet) != 5000000 {
		t.Fatalf("intent %s, recipient %d", status, e.balance(t, wallet))
	}
}

// Our settle succeeded, but a lagging node says the receiver is not settled at latest and has no receipt for it: the
// intent keeps its hash, nothing is signed again, and it is booked once, with our hash, when final.
func TestStaleNotSettledReadKeepsOurSuccessfulSettle(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, receive := e.paidInvoice(t)
	proxy := e.anvil.Proxy()
	s := e.signerVia(t, proxy.URL)
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	var saved string
	if err := e.pool.QueryRow(ctx, "SELECT tx_hash FROM settlement_intents WHERE invoice_id = $1", id).Scan(&saved); err != nil {
		t.Fatal(err)
	}
	lag := func(receipt bool) {
		proxy.Stale(func(c chaintest.Call) json.RawMessage {
			switch {
			case c.Method == "eth_call" && strings.Contains(param(c, 0), receive) &&
				strings.Contains(param(c, 0), hexutil.Encode(settledSelector)) && param(c, 1) == `"latest"`:
				return json.RawMessage(`"0x` + strings.Repeat("0", 64) + `"`)
			case !receipt && c.Method == "eth_getTransactionReceipt" && strings.Contains(param(c, 0), saved):
				return json.RawMessage("null")
			}
			return nil
		})
	}
	before := e.nonce(t)
	for _, step := range []struct {
		name       string
		receipt    bool
		final      bool
		want       string
		unresolved bool
	}{
		{"not settled at latest, no receipt", false, false, "sent", false},
		{"not settled at latest, our receipt", true, false, "sent", false},
		{"final, no receipt", false, true, "sent", true},
		{"final, our receipt", true, false, "confirmed", false},
		{"again", true, false, "confirmed", false},
	} {
		e.dueNow(t)
		lag(step.receipt)
		if step.final {
			e.final(t, s)
		} else if err := s.Run(ctx); err != nil {
			t.Fatal(err)
		}
		var status string
		var hash *string
		if err := e.pool.QueryRow(ctx, "SELECT status, tx_hash FROM settlement_intents WHERE invoice_id = $1", id).
			Scan(&status, &hash); err != nil {
			t.Fatal(err)
		}
		if status != step.want || hash == nil || *hash != saved {
			t.Fatalf("%s: intent %s with hash %v; want %s with our settle %s", step.name, status, hash, step.want, saved)
		}
		// The operators' query for settles the signer can't resolve (docs/backend/architecture.md#signer).
		var unresolved bool
		if err := e.pool.QueryRow(ctx, `SELECT EXISTS (SELECT FROM settlement_intents
			WHERE invoice_id = $1 AND status = 'sent' AND reason IS NOT NULL AND next_attempt_at > now() + interval '30 seconds')`,
			id).Scan(&unresolved); err != nil || unresolved != step.unresolved {
			t.Fatalf("%s: listed as unresolved with a slower retry: %v (%v), want %v", step.name, unresolved, err, step.unresolved)
		}
	}
	if e.nonce(t) != before {
		t.Fatal("the executor signed again after its settle succeeded")
	}
	if hash := e.settlementTxHash(t, id); hash != saved {
		t.Fatalf("settlementTxHash %q, want %s", hash, saved)
	}
	var booked int
	if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM ledger_transactions WHERE invoice_id = $1 AND kind = 'settlement'",
		id).Scan(&booked); err != nil || booked != 1 || e.balance(t, wallet) != 5000000 {
		t.Fatalf("settlement booked %d times (%v), recipient %d; want once and 5000000", booked, err, e.balance(t, wallet))
	}
}

// A lagging node hands out an old pending nonce: the signer takes the one after its last saved settle instead, and
// the one after a deploy it just sent.
func TestStalePendingNonceUsesTheSavedNonce(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	first, _ := e.paidInvoice(t)
	second, _ := e.pay(t, 8)
	if _, err := e.pool.Exec(ctx, "UPDATE settlement_intents SET next_attempt_at = now() + interval '1 hour' WHERE invoice_id = $1",
		second); err != nil {
		t.Fatal(err)
	}
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	e.dueNow(t)
	proxy := e.anvil.Proxy()
	proxy.Stale(func(c chaintest.Call) json.RawMessage {
		if c.Method == "eth_getTransactionCount" && param(c, 1) == `"pending"` {
			return json.RawMessage(`"0x0"`)
		}
		return nil
	})
	s := e.signerVia(t, proxy.URL)
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	e.final(t, s)
	for _, id := range []string{first, second} {
		if status, settlement, _ := e.intent(t, id); status != "confirmed" || settlement != "settled" {
			t.Fatalf("invoice %s: intent %s, settlement %s", id, status, settlement)
		}
	}
	if got := e.balance(t, wallet); got != 10000000 {
		t.Fatalf("recipient got %d, want 10000000", got)
	}
}

// anvil calls an Anvil RPC method that returns nothing the test needs.
func (e env) anvilCall(t *testing.T, method string, args ...any) {
	t.Helper()
	if err := e.anvil.RPC.Call(nil, method, args...); err != nil {
		t.Fatal(err)
	}
}

// saved is the intent's signed settle: its hash and bytes.
func (e env) saved(t *testing.T, invoiceID string) (string, []byte) {
	t.Helper()
	var hash string
	var raw []byte
	if err := e.pool.QueryRow(context.Background(), "SELECT tx_hash, raw_tx FROM settlement_intents WHERE invoice_id = $1",
		invoiceID).Scan(&hash, &raw); err != nil {
		t.Fatal(err)
	}
	return hash, raw
}

// overpriced makes the next blocks' base fee 100 gwei, far over the fee cap the signer used; Anvil then drops a
// pending settle signed before and refuses to take it again, as a node does with a settle whose fee is too low.
func (e env) overpriced(t *testing.T) {
	t.Helper()
	e.anvilCall(t, "anvil_setNextBlockBaseFeePerGas", "0x174876e800")
	e.anvil.Mine(1)
}

// A settle whose fee cap falls below the base fee is dropped by the node and refused when sent again. ReplaceAfter
// after it was signed it is signed again with the same nonce and at least an eighth more tip and fee cap, so it and
// the next settle on the chain mine; it is booked once, with the replacement's hash.
func TestStuckSettleIsReplacedWithAHigherFee(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, _ := e.paidInvoice(t)
	later, _ := e.pay(t, 8)
	if _, err := e.pool.Exec(ctx, "UPDATE settlement_intents SET next_attempt_at = now() + interval '1 hour' WHERE invoice_id = $1",
		later); err != nil {
		t.Fatal(err)
	}
	before := e.nonce(t)
	saving := e.signer(t)
	saving.stopAfter = "save"
	if err := saving.Run(ctx); !errors.Is(err, errStopped) {
		t.Fatalf("got %v", err)
	}
	e.anvilCall(t, "evm_setAutomine", false)
	sending := e.signer(t)
	sending.stopAfter = "send"
	if err := sending.Run(ctx); !errors.Is(err, errStopped) {
		t.Fatalf("got %v", err)
	}
	e.overpriced(t)
	e.anvilCall(t, "evm_setAutomine", true)
	stuck, raw := e.saved(t, id)
	old := new(types.Transaction)
	if err := old.UnmarshalBinary(raw); err != nil {
		t.Fatal(err)
	}

	e.dueNow(t)
	s := e.signer(t)
	s.replaceAfter = 0
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	e.final(t, e.signer(t))
	for _, invoiceID := range []string{id, later} {
		if status, settlement, reason := e.intent(t, invoiceID); status != "confirmed" || settlement != "settled" {
			t.Fatalf("invoice %s: intent %s (%s), settlement %s; want confirmed, settled", invoiceID, status, reason, settlement)
		}
	}
	hash := e.settlementTxHash(t, id)
	tx, _, err := e.client.TransactionByHash(ctx, common.HexToHash(hash))
	if err != nil || hash == stuck {
		t.Fatalf("settlementTxHash %s (stuck %s): %v; want the replacement", hash, stuck, err)
	}
	eighth := func(x *big.Int) *big.Int { return new(big.Int).Div(new(big.Int).Mul(x, big.NewInt(9)), big.NewInt(8)) }
	if tx.Nonce() != old.Nonce() || tx.GasTipCap().Cmp(eighth(old.GasTipCap())) < 0 || tx.GasFeeCap().Cmp(eighth(old.GasFeeCap())) < 0 {
		t.Fatalf("replacement nonce %d tip %s cap %s; stuck nonce %d tip %s cap %s", tx.Nonce(), tx.GasTipCap(), tx.GasFeeCap(),
			old.Nonce(), old.GasTipCap(), old.GasFeeCap())
	}
	if got := e.balance(t, wallet); got != 10000000 {
		t.Fatalf("recipient got %d, want 10000000", got)
	}
	if got := e.nonce(t) - before; got != 4 {
		t.Fatalf("executor used %d nonces, want 4 (two deploys, two settles)", got)
	}
	var booked int
	if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM ledger_transactions WHERE invoice_id = $1 AND kind = 'settlement'",
		id).Scan(&booked); err != nil || booked != 1 {
		t.Fatalf("settlement booked %d times (%v), want once", booked, err)
	}
}

// The version a replacement replaced can still be the one mined: a receipt for any hash signed for the intent books
// it, once, with that hash.
func TestReplacedSettleThatMinesIsBookedOnce(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, _ := e.paidInvoice(t)
	before := e.nonce(t)
	saving := e.signer(t)
	saving.stopAfter = "save"
	if err := saving.Run(ctx); !errors.Is(err, errStopped) {
		t.Fatalf("got %v", err)
	}
	first, raw := e.saved(t, id)
	e.overpriced(t)
	replacing := e.signer(t)
	replacing.replaceAfter, replacing.stopAfter = 0, "save"
	if err := replacing.Run(ctx); !errors.Is(err, errStopped) {
		t.Fatalf("got %v", err)
	}
	if second, _ := e.saved(t, id); second == first {
		t.Fatal("no replacement was saved")
	}
	e.anvilCall(t, "anvil_setNextBlockBaseFeePerGas", "0x1")
	e.anvil.Mine(1)
	e.anvil.SendRaw(hexutil.Encode(raw)) // the first version mines, not the replacement

	s := e.signer(t)
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	e.final(t, s)
	if status, settlement, _ := e.intent(t, id); status != "confirmed" || settlement != "settled" || e.balance(t, wallet) != 5000000 {
		t.Fatalf("intent %s, invoice %s, recipient %d", status, settlement, e.balance(t, wallet))
	}
	if hash := e.settlementTxHash(t, id); hash != first {
		t.Fatalf("settlementTxHash %s, want the mined first version %s", hash, first)
	}
	if got := e.nonce(t) - before; got != 2 {
		t.Fatalf("executor used %d nonces, want 2 (deploy, settle)", got)
	}
	var booked int
	if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM ledger_transactions WHERE invoice_id = $1 AND kind = 'settlement'",
		id).Scan(&booked); err != nil || booked != 1 {
		t.Fatalf("settlement booked %d times (%v), want once", booked, err)
	}
}

// Settle gas is estimated at the deploy's block, where a node has seen the receiver's code; on Arbitrum that estimate
// counts the L1 data gas, more than SettleGasFloor. A node that can't estimate at a block is asked at latest, with
// the floor.
func TestSettleGasIsEstimatedAtTheDeployBlock(t *testing.T) {
	const arbitrum = 400_000 // the at-block estimate with L1 data gas
	for name, refuse := range map[string]bool{"at the deploy block": false, "node refuses a block": true} {
		t.Run(name, func(t *testing.T) {
			e := setup(t)
			ctx := context.Background()
			id, receive := e.paidInvoice(t)
			proxy := e.anvil.Proxy()
			atBlock := func(c chaintest.Call) bool {
				return c.Method == "eth_estimateGas" && strings.Contains(param(c, 0), receive) && strings.HasPrefix(param(c, 1), `"0x`)
			}
			proxy.Stale(func(c chaintest.Call) json.RawMessage {
				switch {
				case atBlock(c) && !refuse:
					return json.RawMessage(fmt.Sprintf(`"0x%x"`, arbitrum))
				case !atBlock(c) && c.Method == "eth_estimateGas" && strings.Contains(param(c, 0), receive):
					return json.RawMessage(`"0x5248"`) // a node at latest that has not seen the deploy
				}
				return nil
			})
			if refuse {
				proxy.Fail(func(c chaintest.Call) chaintest.Fault {
					if atBlock(c) {
						return chaintest.RateLimited
					}
					return chaintest.Forward
				})
			}
			s := e.signerVia(t, proxy.URL)
			if err := s.Run(ctx); err != nil {
				t.Fatal(err)
			}
			hash, _ := e.saved(t, id)
			settle, _, err := e.client.TransactionByHash(ctx, common.HexToHash(hash))
			if err != nil {
				t.Fatal(err)
			}
			want := uint64(arbitrum + arbitrum/5)
			if refuse {
				want = SettleGasFloor + SettleGasFloor/5
			}
			if settle.Gas() != want {
				t.Fatalf("settle gas %d, want %d", settle.Gas(), want)
			}
			deploy, err := e.client.TransactionReceipt(ctx, common.HexToHash(e.deployHash(t, proxy)))
			if err != nil {
				t.Fatal(err)
			}
			for _, c := range proxy.Calls() {
				if atBlock(c) && param(c, 1) != fmt.Sprintf(`"0x%x"`, deploy.BlockNumber) {
					t.Fatalf("estimated at block %s, want the deploy's %d", param(c, 1), deploy.BlockNumber)
				}
			}
			e.final(t, s)
			if status, _, _ := e.intent(t, id); status != "confirmed" || e.balance(t, wallet) != 5000000 {
				t.Fatalf("intent %s, recipient %d", status, e.balance(t, wallet))
			}
		})
	}
}

// deployHash is the hash of the factory deploy the signer sent through proxy.
func (e env) deployHash(t *testing.T, proxy *chaintest.Proxy) string {
	t.Helper()
	for _, c := range proxy.Calls() {
		if c.Method != "eth_sendRawTransaction" {
			continue
		}
		var raw hexutil.Bytes
		tx := new(types.Transaction)
		if json.Unmarshal(c.Params[0], &raw) == nil && tx.UnmarshalBinary(raw) == nil && *tx.To() == common.Address(address.Factory) {
			return tx.Hash().Hex()
		}
	}
	t.Fatal("no deploy sent")
	return ""
}

// A replacement never pays a fee cap over MaxFeeFactor times what a new settle gets now: a settle signed while the
// base fee was high is sent again as it is once it has dropped.
func TestStuckSettleOverTheMaxFeeIsSentAgainAsItIs(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, _ := e.paidInvoice(t)
	e.anvilCall(t, "anvil_setNextBlockBaseFeePerGas", "0x2540be400") // 10 gwei while it signs
	e.anvil.Mine(1)
	saving := e.signer(t)
	saving.stopAfter = "save"
	if err := saving.Run(ctx); !errors.Is(err, errStopped) {
		t.Fatalf("got %v", err)
	}
	first, _ := e.saved(t, id)
	e.anvilCall(t, "anvil_setNextBlockBaseFeePerGas", "0x1")
	e.anvil.Mine(1)
	s := e.signer(t)
	s.replaceAfter = 0
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	e.final(t, s)
	if status, _, _ := e.intent(t, id); status != "confirmed" || e.settlementTxHash(t, id) != first {
		t.Fatalf("intent %s with %s, want confirmed with the saved settle %s", status, e.settlementTxHash(t, id), first)
	}
}

func TestSettlementIsBookedOnlyWhenTheSecondRPCAgrees(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, _ := e.paidInvoice(t)
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	proxy := e.anvil.Proxy()
	notSettled := json.RawMessage(`"0x` + strings.Repeat("0", 64) + `"`)
	proxy.Stale(func(c chaintest.Call) json.RawMessage {
		if c.Method == "eth_call" && strings.Contains(param(c, 0), hexutil.Encode(settledSelector)[2:]) {
			return notSettled
		}
		return nil
	})
	second, err := ethclient.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(second.Close)
	doubtful := e.signer(t)
	doubtful.seconds = map[uint64]*ethclient.Client{chaintest.ChainID: second}
	e.final(t, doubtful)
	if status, settlement, _ := e.intent(t, id); status != "sent" || settlement != "pending" {
		t.Fatalf("second RPC says not settled: intent %s, invoice settlement %s; want sent, pending", status, settlement)
	}
	e.final(t, e.signer(t))
	if status, settlement, _ := e.intent(t, id); status != "confirmed" || settlement != "settled" {
		t.Fatalf("both RPCs agree: intent %s, invoice settlement %s; want confirmed, settled", status, settlement)
	}
}

// SEC-03: a user's invoices get at most SponsoredPerDay settlements from the executor's gas in 24 hours; the next
// one waits, unsent, with the reason.
func TestSponsoredSettlementsPerUserAreCapped(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `
		WITH i AS (
		    INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		        settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		        request_hash)
		    SELECT '0x' || lpad(to_hex(1000 + n), 64, '0'), w.profile_id, $1, 'evm', $2, 1, 4000000000, 4000086400, $3,
		        'evm_create2', '0x2222222222222222222222222222222222222222', '0x' || lpad(to_hex(1000 + n), 40, '0'),
		        'used-' || n, decode(repeat('00', 32), 'hex')
		    FROM generate_series(1, $4::int) n, profile_wallets w RETURNING id)
		INSERT INTO settlement_intents (invoice_id, status, sender, nonce, tx_hash, raw_tx, signed_at)
		SELECT id, 'confirmed', $5, row_number() OVER (), '0x' || repeat('ab', 32), '\x00', now() FROM i`,
		chaintest.ChainID, e.token, wallet, SponsoredPerDay, strings.ToLower(chaintest.Sender)); err != nil {
		t.Fatal(err)
	}
	id, _ := e.paidInvoice(t)
	before := e.nonce(t)
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if status, _, reason := e.intent(t, id); status != "pending" || !strings.Contains(reason, "sponsored") ||
		e.wait(t, id) != waitCap || e.nonce(t) != before {
		t.Fatalf("over the budget: intent %s (%s), %d transactions sent; want pending and none", status, reason,
			e.nonce(t)-before)
	}
}

func TestSignerStopsWhenItLosesItsLock(t *testing.T) {
	e := setup(t)
	id, _ := e.paidInvoice(t)
	s := e.signer(t)
	s.held = func(context.Context) error { return errors.New("lock lost") }
	before := e.nonce(t)
	if err := s.Run(context.Background()); err == nil || e.nonce(t) != before {
		t.Fatalf("without the lock: %v, %d transactions sent; want an error and none", err, e.nonce(t)-before)
	}
	if status, _, _ := e.intent(t, id); status != "pending" {
		t.Fatalf("intent %s, want pending", status)
	}
}

// A nonce nothing will ever use holds every later transaction: the signer fills it with a transfer to itself, unless
// a saved settle holds it.
func TestNonceGapIsFilled(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	s := e.signer(t)
	before := e.nonce(t)
	if err := s.fillGap(ctx, e.client, chaintest.ChainID, before); err != nil {
		t.Fatal(err)
	}
	e.anvil.Mine(1)
	if got := e.nonce(t); got != before+1 {
		t.Fatalf("executor nonce %d, want %d after the filler", got, before+1)
	}
	id, _ := e.paidInvoice(t) // pays from Anvil's account, the executor here
	held := e.nonce(t)
	if _, err := e.pool.Exec(ctx, `UPDATE settlement_intents SET status = 'sent', sender = $2, nonce = $3,
		tx_hash = '0x' || repeat('ab', 32), raw_tx = '\x00' WHERE invoice_id = $1`, id,
		strings.ToLower(chaintest.Sender), int64(held)); err != nil {
		t.Fatal(err)
	}
	if err := s.fillGap(ctx, e.client, chaintest.ChainID, held); err != nil {
		t.Fatal(err)
	}
	e.anvil.Mine(1)
	if got := e.nonce(t); got != held {
		t.Fatalf("a nonce held by a saved settle was filled: executor nonce %d", got)
	}
}

// A transaction the fee left behind at the executor's next nonce is replaced by the next deploy at twice today's fee.
func TestDeployReplacesAStuckTransaction(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	if err := e.anvil.RPC.Call(nil, "evm_setAutomine", false); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = e.anvil.RPC.Call(nil, "evm_setAutomine", true) }()
	s := e.signer(t)
	mined := e.nonce(t)
	stuck, err := s.sign(ctx, e.client, chaintest.ChainID, s.sender, nil, 0, 21_000, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.client.SendTransaction(ctx, stuck); err != nil {
		t.Fatal(err)
	}
	next, err := s.sign(ctx, e.client, chaintest.ChainID, s.sender, nil, 0, 21_000, nil)
	if err != nil {
		t.Fatal(err)
	}
	if next.Nonce() != mined+1 {
		t.Fatalf("next signed at nonce %d, want %d behind the pending one", next.Nonce(), mined+1)
	}
	over, err := s.overStuck(ctx, e.client, chaintest.ChainID, next)
	if err != nil {
		t.Fatal(err)
	}
	if over.Nonce() != mined || over.GasFeeCap().Cmp(new(big.Int).Mul(next.GasFeeCap(), big.NewInt(2))) != 0 {
		t.Fatalf("replacement at nonce %d fee cap %s; want nonce %d at twice %s", over.Nonce(), over.GasFeeCap(), mined,
			next.GasFeeCap())
	}
	if err := e.client.SendTransaction(ctx, over); err != nil {
		t.Fatalf("the replacement is refused: %v", err)
	}
}

// On Tempo (its fee manager has code) a settle gets at least TempoSettleGasFloor, plus a fifth.
func TestTempoSettleGasFloor(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	if err := e.anvil.RPC.Call(nil, "anvil_setCode", tempoFeeManager, hexutil.Encode([]byte{0x60, 0, 0x60, 0, 0x52, 0x60, 32, 0x60, 0, 0xf3})); err != nil {
		t.Fatal(err)
	}
	id, _ := e.paidInvoice(t)
	if err := e.signer(t).Run(ctx); err != nil {
		t.Fatal(err)
	}
	var raw []byte
	if err := e.pool.QueryRow(ctx, "SELECT raw_tx FROM settlement_intents WHERE invoice_id = $1", id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var tx types.Transaction
	if err := tx.UnmarshalBinary(raw); err != nil {
		t.Fatal(err)
	}
	if want := uint64(TempoSettleGasFloor) * 6 / 5; tx.Gas() < want {
		t.Fatalf("settle gas %d, want at least %d", tx.Gas(), want)
	}
}

// A replacement settle never keeps a gas limit below a fresh estimate plus a fifth: on Arbitrum the L1 data cost in it
// grows with L1 prices.
func TestReplacementSettleGetsAFreshGasLimit(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id, receive := e.paidInvoice(t)
	saving := e.signer(t)
	saving.stopAfter = "save"
	if err := saving.Run(ctx); !errors.Is(err, errStopped) {
		t.Fatalf("got %v", err)
	}
	_, raw := e.saved(t, id)
	saved := new(types.Transaction)
	if err := saved.UnmarshalBinary(raw); err != nil {
		t.Fatal(err)
	}
	s := e.signer(t)
	low, err := types.SignTx(types.NewTx(&types.DynamicFeeTx{ChainID: saved.ChainId(), Nonce: saved.Nonce(),
		GasTipCap: saved.GasTipCap(), GasFeeCap: saved.GasFeeCap(), Gas: 30_000, To: saved.To(), Data: saved.Data()}),
		types.LatestSignerForChainID(saved.ChainId()), s.key)
	if err != nil {
		t.Fatal(err)
	}
	lowRaw, _ := low.MarshalBinary()
	var intentID int64
	if err := e.pool.QueryRow(ctx, `UPDATE settlement_intents SET tx_hash = $2, raw_tx = $3 WHERE invoice_id = $1
		RETURNING id`, id, low.Hash().Hex(), lowRaw).Scan(&intentID); err != nil {
		t.Fatal(err)
	}
	in, err := s.load(ctx, intentID)
	if err != nil {
		t.Fatal(err)
	}
	to := common.HexToAddress(receive)
	est, err := e.client.EstimateGas(ctx, ethereum.CallMsg{From: s.sender, To: &to, Data: settleSelector})
	if err != nil {
		t.Fatal(err)
	}
	replaced, err := s.replace(ctx, e.client, in, low)
	if err != nil {
		t.Fatal(err)
	}
	if replaced.Gas() < est+est/5 {
		t.Fatalf("replacement gas %d, want at least %d (estimate %d plus a fifth)", replaced.Gas(), est+est/5, est)
	}
}

// Payer chooses (R-56, D-76): the signer settles the option that received money first, built by the API like any
// invoice, and money sent to another option stays at its address, held for the payer.
func TestSettlesTheOptionPaidFirst(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	usdt := e.anvil.DeployToken()
	e.anvil.Mint(usdt, "1000000000")
	var profile string
	if err := e.pool.QueryRow(ctx, `WITH t AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals,
		enabled) VALUES ($1, 'evm', $2, 'USDT', 6, true)) SELECT profile_id::text FROM profile_wallets`,
		chaintest.ChainID, usdt).Scan(&profile); err != nil {
		t.Fatal(err)
	}
	inv, _, err := invoice.NewService(e.pool).Create(ctx, profile, "k", invoice.Request{AmountUSD: "5"})
	if err != nil {
		t.Fatal(err)
	}
	if len(inv.Options) != 2 || inv.Options[0].Symbol != "USDC" || inv.Options[1].Symbol != "USDT" {
		t.Fatalf("options %+v, want USDC and USDT", inv.Options)
	}
	usdcOption, usdtOption := inv.Options[0], inv.Options[1]
	round := func() {
		t.Helper()
		if err := e.watch.Scan(ctx); err != nil {
			t.Fatal(err)
		}
		if err := e.ledger.ProcessChain(ctx, chaintest.ChainID); err != nil {
			t.Fatal(err)
		}
	}
	e.anvil.Transfer(usdt, usdtOption.ReceiveAddress, "5000000")
	round()
	e.anvil.Transfer(e.token, usdcOption.ReceiveAddress, "5000000") // too late: USDT was chosen
	e.anvil.Mine(2)
	round()

	s := e.signer(t)
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	e.final(t, s)
	if status, settlement, _ := e.intent(t, usdtOption.ID); status != "confirmed" || settlement != "settled" {
		t.Fatalf("USDT option: intent %s, settlement %s", status, settlement)
	}
	balanceOf := ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: e.client})
	if got, _, err := balanceOf(ctx, chaintest.ChainID, usdt, wallet); err != nil || got.Int64() != 5000000 {
		t.Fatalf("recipient holds %v USDT (%v), want 5000000", got, err)
	}
	if got := e.balance(t, usdcOption.ReceiveAddress); got != 5000000 {
		t.Fatalf("the USDC option's address holds %d, want the 5000000 held for the payer", got)
	}
	var intents int
	if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM settlement_intents").Scan(&intents); err != nil || intents != 1 {
		t.Fatalf("%d settlement intents (%v), want 1", intents, err)
	}
	got, err := invoice.NewService(e.pool).Get(ctx, inv.ID)
	if err != nil || got.OptionID != usdtOption.ID || !got.OptionLocked || got.SettlementStatus != "settled" {
		t.Fatalf("invoice shows option %s locked %v settlement %s (%v)", got.OptionID, got.OptionLocked,
			got.SettlementStatus, err)
	}
	// The read lists the held USDC payment under its own option, and only the USDT one as the invoice's (F143).
	if len(got.Deposits) != 1 || len(got.Options[1].Deposits) != 1 || got.Options[1].ID != usdtOption.ID {
		t.Fatalf("invoice deposits %+v, options %+v", got.Deposits, got.Options)
	}
	if held := got.Options[0].Deposits; len(held) != 1 || held[0].Amount.Int64() != 5000000 || held[0].Status != "confirmed" {
		t.Fatalf("USDC option deposits %+v, want the held 5000000", held)
	}
}
