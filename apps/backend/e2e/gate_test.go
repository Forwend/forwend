//go:build e2e

// Package e2e runs the whole money loop with the real binaries (R-23): pnpm --filter @forwend/backend e2e.
// It needs Postgres (pnpm --filter @forwend/backend postgres:up) and Foundry on PATH.
package e2e

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/auth/authtest"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/webhook"
	"github.com/ethereum/go-ethereum"
	gethcommon "github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
)

const (
	appID  = "gate-app"
	wallet = "0x1111111111111111111111111111111111111111" // the creator's profile wallet
	amount = "5000000"
)

// TestMoneyLoop pays an invoice on Anvil and follows it to settled through the worker and signer; the ledger then
// equals the chain.
func TestMoneyLoop(t *testing.T) {
	ctx := context.Background()
	st := newStack(t)
	anvil, token, privy, api, conn, profile, limited := st.anvil, st.token, st.privy, st.api, st.conn, st.profile, st.limited
	start(t, st.bin, "worker", st.loop)
	start(t, st.bin, "signer", append(st.loop, "EXECUTOR_PRIVATE_KEY="+chaintest.Key))
	st.waitScanned(t)
	waitFor(t, "the worker's ECB rates", func() bool {
		var n int
		return conn.QueryRow(ctx, "SELECT count(*) FROM ecb_rates").Scan(&n) == nil && n > 0
	})

	// R-148: an endpoint whose URL names this machine; saving refuses that, so the test sets it. Saved here, not
	// through the API, whose fresh sign-in check asks the real Privy.
	var hooked atomic.Int32
	hookServer := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hooked.Add(1) }))
	t.Cleanup(hookServer.Close)
	pool, err := database.Open(ctx, st.db)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	key, _ := base64.StdEncoding.DecodeString(webhookKey)
	if _, _, err := webhook.NewService(pool, key).Save(ctx, profile, "eeeeeeee-0000-4000-8000-000000000001",
		webhook.Details{URL: "https://hooks.example.com/", Events: []string{webhook.InvoicePaid}, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, "UPDATE webhook_endpoints SET url = $1", hookServer.URL+"/hooks"); err != nil {
		t.Fatal(err)
	}
	start(t, st.bin, "webhooks", st.hooks)

	body := fmt.Sprintf(`{"chainId": %d, "token": %q, "amount": %q}`, chaintest.ChainID, token, amount)
	status, created := post(t, api+"/v1/profiles/"+profile+"/invoices", privy, "gate-1", body)
	if status != http.StatusCreated {
		t.Fatalf("create invoice: %d %v", status, created)
	}
	id, pay, receive := created["invoiceId"].(string), created["payToken"].(string), created["receiveAddress"].(string)

	var seen, deposit []string
	note := func(list *[]string, state string) {
		if len(*list) == 0 || (*list)[len(*list)-1] != state {
			*list = append(*list, state)
		}
	}
	observe := func() string {
		inv := get(t, api+"/v1/invoices/"+pay)
		state := inv["paymentStatus"].(string)
		if inv["settlementStatus"] == "settled" {
			state = "settled"
		}
		note(&seen, state)
		if deposits, _ := inv["deposits"].([]any); len(deposits) > 0 {
			d := deposits[0].(map[string]any)
			note(&deposit, fmt.Sprintf("%s/%v", d["status"], d["blocksLeft"].(float64) > 0))
		}
		return state
	}

	anvil.Transfer(token, receive, amount)
	waitFor(t, "detected", func() bool { return observe() == ledger.Detected })
	anvil.Mine(2) // the deposit's block becomes final (Anvil: finalized = latest - 2)
	// Real chains keep making blocks; Anvil only mines on demand, so the settle can become final (D-45).
	waitFor(t, "settled", func() bool { anvil.Mine(1); return observe() == "settled" })
	if !inOrder(seen, ledger.Detected, ledger.Paid, "settled") || !inOrder(deposit, "detected/true", "confirmed/false") {
		t.Fatalf("invoice %v, deposit %v; want invoice detected -> paid -> settled and the deposit detected with "+
			"blocks left -> confirmed", seen, deposit)
	}
	t.Logf("invoice: %v; deposit (status/blocks left): %v", seen, deposit)
	// The webhooks process built, signed and tried the paid event; its filter refused this machine's address.
	waitFor(t, "the paid event's attempt", func() bool {
		var refused string
		return conn.QueryRow(ctx, "SELECT coalesce(error, '') FROM webhook_attempts ORDER BY id LIMIT 1").
			Scan(&refused) == nil && refused == "address not public"
	})
	if n := hooked.Load(); n != 0 {
		t.Fatalf("the receiver on this machine got %d requests", n)
	}
	refused := 0
	for _, c := range limited.Calls() {
		if c.Fault == chaintest.HTTP429 {
			refused++
		}
	}
	if refused == 0 {
		t.Fatal("the rate-limited RPC refused no request: the loop did not meet a 429")
	}
	t.Logf("the first RPC answered %d of %d requests with 429", refused, len(limited.Calls()))
	hash, _ := get(t, api+"/v1/invoices/"+pay)["settlementTxHash"].(string)
	settleTx, _, err := ethclient.NewClient(anvil.RPC).TransactionByHash(ctx, gethcommon.HexToHash(hash))
	if err != nil || settleTx.To() == nil || !strings.EqualFold(settleTx.To().Hex(), receive) {
		t.Fatalf("settlementTxHash %q: %v, want the settle transaction to %s", hash, err, receive)
	}
	// D-86: the settle deployed the receiver, whose event shows the invoice id to anyone; that id opens no public route.
	logs, err := ethclient.NewClient(anvil.RPC).FilterLogs(ctx, ethereum.FilterQuery{
		Topics: [][]gethcommon.Hash{{crypto.Keccak256Hash([]byte("ReceiverDeployed(address,bytes32)"))}}})
	if err != nil || len(logs) != 1 || logs[0].Topics[2].Hex() != id {
		t.Fatalf("ReceiverDeployed logs %v (%v), want one naming %s", logs, err, id)
	}
	for _, r := range []struct{ method, path, body string }{{http.MethodGet, "", ""}, {http.MethodGet, "/invoice.pdf", ""},
		{http.MethodGet, "/receipt.pdf", ""}, {http.MethodPost, "/recheck", ""},
		{http.MethodPut, "/payer-email", `{"email": "a@example.com"}`}} {
		req, _ := http.NewRequest(r.method, api+"/v1/invoices/"+id+r.path, strings.NewReader(r.body))
		if status, body := do(t, req); status != http.StatusNotFound {
			t.Fatalf("%s %s by the on-chain id: %d %v, want 404", r.method, r.path, status, body)
		}
	}

	balance := ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: ethclient.NewClient(anvil.RPC)})
	for holder, want := range map[string]int64{receive: 0, wallet: 5000000} {
		got, _, err := balance(ctx, chaintest.ChainID, token, holder)
		if err != nil || got.Int64() != want {
			t.Fatalf("balance of %s: %v %v, want %d", holder, got, err, want)
		}
	}
	var receiver, owed, held int64
	if err := conn.QueryRow(ctx, `SELECT
		coalesce(sum(e.amount) FILTER (WHERE account = 'receiver'), 0)::bigint,
		-coalesce(sum(e.amount) FILTER (WHERE account = 'recipient_payable'), 0)::bigint,
		-coalesce(sum(e.amount) FILTER (WHERE account = 'payer_held'), 0)::bigint
		FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id WHERE x.invoice_id = $1`, id).
		Scan(&receiver, &owed, &held); err != nil || receiver != 0 || owed != 0 || held != 0 {
		t.Fatalf("ledger receiver %d owed %d held %d (%v), want all 0 like the chain", receiver, owed, held, err)
	}

	// The wallet's balance is read at the finalized block.
	anvil.Mine(2)
	money := authed(t, api+"/v1/profiles/"+profile+"/balances", privy)
	tokens, _ := money["tokens"].([]any)
	if len(tokens) != 1 || money["estimatedUsdTotal"] != "5.00" {
		t.Fatalf("balances %v, want the one token and an estimated 5.00 USD", money)
	}
	if tk := tokens[0].(map[string]any); tk["wallet"] != amount || tk["pending"] != "0" || tk["held"] != "0" {
		t.Fatalf("balance %v, want wallet %s and nothing pending or held", tk, amount)
	}
	items, _ := authed(t, api+"/v1/profiles/"+profile+"/activity", privy)["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["kind"] != "deposit" || items[1].(map[string]any)["kind"] != "invoice" {
		t.Fatalf("activity %v, want the deposit then the invoice", items)
	}

	status, again := post(t, api+"/v1/profiles/"+profile+"/invoices", privy, "gate-1", body)
	if status != http.StatusOK || again["invoiceId"] != id {
		t.Fatalf("same key again: %d %v, want 200 with %s", status, again["invoiceId"], id)
	}
	var n int
	if err := conn.QueryRow(ctx, "SELECT count(*) FROM invoices").Scan(&n); err != nil || n != 1 {
		t.Fatalf("%d invoices, want 1", n)
	}
}

// stack runs the api; tests start the worker and signer themselves.
type stack struct {
	anvil          *chaintest.Anvil
	limited        *chaintest.Proxy
	privy          *authtest.Privy
	conn           *pgx.Conn
	bin, api, db   string
	token, profile string
	loop           []string // the worker's and signer's environment
	hooks          []string // the webhooks process's: the database and the webhook key, nothing else
}

// webhookKey stands in for WEBHOOK_SECRET_KEY: 32 bytes in base64.
const webhookKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="

func newStack(t *testing.T) *stack {
	t.Helper()
	ctx := context.Background()
	anvil := chaintest.Start(t)
	anvil.DeployFactory()
	token := anvil.DeployToken()
	anvil.Mint(token, "1000000000")
	privy := authtest.NewPrivy(t)
	dbURL := databasetest.New(t)
	bin := build(t)

	chains := filepath.Join(t.TempDir(), "chains.json")
	// Two host names for the one Anvil give the second, independent RPC for balances (D-15).
	limited, requests := anvil.Proxy(), 0
	limited.Fail(func(chaintest.Call) chaintest.Fault {
		if requests++; requests%3 == 0 {
			return chaintest.HTTP429
		}
		return chaintest.Forward
	})
	second := strings.Replace(anvil.URL, "127.0.0.1", "localhost", 1)
	if err := os.WriteFile(chains, fmt.Appendf(nil, `{"anvil": {"chainId": %d, "infura": null, "public": [%q, %q, %q]}}`,
		chaintest.ChainID, limited.URL, anvil.URL, second), 0o600); err != nil {
		t.Fatal(err)
	}
	// The worker's ECB rates (R-110).
	ecbFake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `<Envelope><Cube><Cube time="2026-10-16"><Cube currency="USD" rate="1.1253"/></Cube></Cube></Envelope>`)
	}))
	t.Cleanup(ecbFake.Close)
	apiAddr := freeAddr(t)
	common := []string{"DATABASE_URL=" + dbURL}
	rpcs := []string{"CHAINS_FILE=" + chains, "INFURA_API_KEYS=", "RPC_RATE_PER_SECOND=100"}
	start(t, bin, "api", append(append(common, rpcs...), "API_ADDR="+apiAddr, "PRIVY_APP_ID="+appID,
		"PRIVY_JWKS_URL="+privy.JWKSURL, "PRIVY_APP_SECRET=unused", // this test makes its profile in the database
		"PUBLIC_WEB_URL=http://localhost:3000", "WEBHOOK_SECRET_KEY="+webhookKey))
	api := "http://" + apiAddr
	waitFor(t, "api healthy", func() bool {
		res, err := http.Get(api + "/healthz")
		if err == nil {
			res.Body.Close()
		}
		return err == nil && res.StatusCode == http.StatusOK
	})

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close(ctx) })
	var profile string
	err = conn.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES ($1, 'evm', 'anvil', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES ($1, 'evm', $2, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id, login_email) VALUES ('did:privy:gate', 'owner@example.com') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w1', 'evm', $3 FROM p),
		     b AS (INSERT INTO profile_billing_details (profile_id, name, address, country, contact_email)
		           SELECT id, 'Gate', 'Main St 1', 'DE', 'owner@example.com' FROM p)
		SELECT id::text FROM p`, chaintest.ChainID, token, wallet).Scan(&profile)
	if err != nil {
		t.Fatal(err)
	}
	return &stack{anvil: anvil, limited: limited, privy: privy, conn: conn, bin: bin, api: api, db: dbURL, token: token,
		// Clipped: an append for one binary must never write into another's environment.
		profile: profile, loop: slices.Clip(append(append(common, rpcs...), "POLL_INTERVAL=200ms",
			"ECB_RATES_URL="+ecbFake.URL)), hooks: slices.Clip(append(common, "WEBHOOK_SECRET_KEY="+webhookKey))}
}

// waitScanned: invoices are made only once a chain is watched.
func (s *stack) waitScanned(t *testing.T) {
	t.Helper()
	waitFor(t, "the worker's first scan", func() bool {
		var n int
		return s.conn.QueryRow(context.Background(), "SELECT count(*) FROM chain_cursors").Scan(&n) == nil && n > 0
	})
}

func build(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	out, err := exec.Command("go", "build", "-o", dir+"/", "../cmd/api", "../cmd/worker", "../cmd/signer",
		"../cmd/webhooks").CombinedOutput()
	if err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	return dir
}

func start(t *testing.T, bin, name string, env []string) (stop func()) {
	t.Helper()
	var logs bytes.Buffer
	cmd := exec.Command(filepath.Join(bin, name))
	cmd.Env = append(env, "PATH="+os.Getenv("PATH"), "HOME="+os.Getenv("HOME"))
	cmd.Stdout, cmd.Stderr = &logs, &logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	var once sync.Once
	stop = func() {
		once.Do(func() {
			_ = cmd.Process.Signal(os.Interrupt)
			_ = cmd.Wait()
		})
	}
	t.Cleanup(func() {
		stop()
		if t.Failed() {
			t.Logf("%s output:\n%s", name, logs.String())
		}
	})
	return stop
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().String()
}

func post(t *testing.T, url string, privy *authtest.Privy, key, body string) (int, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token(t, privy))
	req.Header.Set("Idempotency-Key", key)
	return do(t, req)
}

func get(t *testing.T, url string) map[string]any {
	t.Helper()
	return getAs(t, url, "")
}

func authed(t *testing.T, url string, privy *authtest.Privy) map[string]any {
	t.Helper()
	return getAs(t, url, token(t, privy))
}

func getAs(t *testing.T, url, bearer string) map[string]any {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	status, body := do(t, req)
	if status != http.StatusOK {
		t.Fatalf("GET %s: %d %v", url, status, body)
	}
	return body
}

func token(t *testing.T, privy *authtest.Privy) string {
	t.Helper()
	now := time.Now()
	return authtest.Sign(t, privy.Key("key-1"), "key-1", jwt.MapClaims{"sid": "gate", "sub": "did:privy:gate", "iss": "privy.io",
		"aud": appID, "iat": now.Unix(), "exp": now.Add(time.Hour).Unix()})
}

func do(t *testing.T, req *http.Request) (int, map[string]any) {
	t.Helper()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("%s %s: %d, not JSON: %s", req.Method, req.URL, res.StatusCode, raw)
	}
	return res.StatusCode, body
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(60 * time.Second); !ok(); time.Sleep(100 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
	}
}

func inOrder(seen []string, want ...string) bool {
	i := 0
	for _, s := range seen {
		if i < len(want) && s == want[i] {
			i++
		}
	}
	return i == len(want)
}
