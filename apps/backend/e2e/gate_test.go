//go:build e2e

// Package e2e runs the whole money loop with the real binaries (R-23): pnpm --filter @forwend/backend e2e.
// It needs Postgres (pnpm --filter @forwend/backend postgres:up) and Foundry on PATH.
package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/auth/authtest"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
)

const (
	appID  = "gate-app"
	wallet = "0x1111111111111111111111111111111111111111" // the creator's profile wallet
	amount = "5000000"
)

// TestMoneyLoop: create an invoice through the API, pay it on Anvil, and watch it go detected -> confirmed ->
// paid -> settled through the worker and signer; the ledger then equals the chain. The same request again gives
// the same invoice.
func TestMoneyLoop(t *testing.T) {
	ctx := context.Background()
	anvil := chaintest.Start(t)
	anvil.DeployFactory()
	token := anvil.DeployToken()
	anvil.Mint(token, "1000000000")
	privy := authtest.NewPrivy(t)
	dbURL := databasetest.New(t)
	bin := build(t)

	chains := filepath.Join(t.TempDir(), "chains.json")
	// Two host names for the one Anvil: the worker needs a second, independent RPC for balances (D-15).
	second := strings.Replace(anvil.URL, "127.0.0.1", "localhost", 1)
	if err := os.WriteFile(chains, fmt.Appendf(nil, `{"anvil": {"chainId": %d, "infura": null, "public": [%q, %q]}}`,
		chaintest.ChainID, anvil.URL, second), 0o600); err != nil {
		t.Fatal(err)
	}
	apiAddr := freeAddr(t)
	common := []string{"DATABASE_URL=" + dbURL}
	loop := append(common, "CHAINS_FILE="+chains, "INFURA_API_KEYS=none", "POLL_INTERVAL=200ms")
	start(t, bin, "api", append(common, "API_ADDR="+apiAddr, "PRIVY_APP_ID="+appID, "PRIVY_JWKS_URL="+privy.JWKSURL))
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
	defer conn.Close(ctx)
	var profile string
	err = conn.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES ($1, 'evm', 'anvil', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES ($1, 'evm', $2, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:gate') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w1', 'evm', $3 FROM p)
		SELECT id::text FROM p`, chaintest.ChainID, token, wallet).Scan(&profile)
	if err != nil {
		t.Fatal(err)
	}
	start(t, bin, "worker", loop)
	start(t, bin, "signer", append(loop, "EXECUTOR_PRIVATE_KEY="+chaintest.Key))

	body := fmt.Sprintf(`{"chainId": %d, "token": %q, "amount": %q}`, chaintest.ChainID, token, amount)
	status, created := post(t, api+"/v1/profiles/"+profile+"/invoices", privy, body)
	if status != http.StatusCreated {
		t.Fatalf("create invoice: %d %v", status, created)
	}
	id, receive := created["invoiceId"].(string), created["receiveAddress"].(string)

	// Every state the API shows on the way, in order: the invoice's, and its deposit's with blocks left.
	var seen, deposit []string
	note := func(list *[]string, state string) {
		if len(*list) == 0 || (*list)[len(*list)-1] != state {
			*list = append(*list, state)
		}
	}
	observe := func() string {
		inv := get(t, api+"/v1/invoices/"+id)
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
	waitFor(t, "settled", func() bool { return observe() == "settled" })
	if !inOrder(seen, ledger.Detected, ledger.Paid, "settled") || !inOrder(deposit, "detected/true", "confirmed/false") {
		t.Fatalf("invoice %v, deposit %v; want invoice detected -> paid -> settled and the deposit detected with "+
			"blocks left -> confirmed", seen, deposit)
	}
	t.Logf("invoice: %v; deposit (status/blocks left): %v", seen, deposit)

	// The ledger equals the chain: the receive address is empty, the creator holds the amount.
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

	// The same request with the same key: the same invoice, still one.
	status, again := post(t, api+"/v1/profiles/"+profile+"/invoices", privy, body)
	if status != http.StatusOK || again["invoiceId"] != id {
		t.Fatalf("same key again: %d %v, want 200 with %s", status, again["invoiceId"], id)
	}
	var n int
	if err := conn.QueryRow(ctx, "SELECT count(*) FROM invoices").Scan(&n); err != nil || n != 1 {
		t.Fatalf("%d invoices, want 1", n)
	}
}

// build compiles the three binaries once for this test.
func build(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	out, err := exec.Command("go", "build", "-o", dir+"/", "../cmd/api", "../cmd/worker", "../cmd/signer").CombinedOutput()
	if err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	return dir
}

// start runs a binary with only the given environment; its output is shown if the test fails.
func start(t *testing.T, bin, name string, env []string) {
	t.Helper()
	var logs bytes.Buffer
	cmd := exec.Command(filepath.Join(bin, name))
	cmd.Env = append(env, "PATH="+os.Getenv("PATH"), "HOME="+os.Getenv("HOME"))
	cmd.Stdout, cmd.Stderr = &logs, &logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Signal(os.Interrupt)
		_ = cmd.Wait()
		if t.Failed() {
			t.Logf("%s output:\n%s", name, logs.String())
		}
	})
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

func post(t *testing.T, url string, privy *authtest.Privy, body string) (int, map[string]any) {
	t.Helper()
	now := time.Now()
	token := authtest.Sign(t, privy.Key("key-1"), "key-1", jwt.MapClaims{"sub": "did:privy:gate", "iss": "privy.io",
		"aud": appID, "iat": now.Unix(), "exp": now.Add(time.Hour).Unix()})
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Idempotency-Key", "gate-1")
	return do(t, req)
}

func get(t *testing.T, url string) map[string]any {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	status, body := do(t, req)
	if status != http.StatusOK {
		t.Fatalf("GET %s: %d %v", url, status, body)
	}
	return body
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

// inOrder reports whether want appears in seen in this order (other states may come between).
func inOrder(seen []string, want ...string) bool {
	i := 0
	for _, s := range seen {
		if i < len(want) && s == want[i] {
			i++
		}
	}
	return i == len(want)
}
