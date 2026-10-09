package httpapi

import (
	"context"
	"crypto/ecdsa"
	"encoding/hex"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	usdc        = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
	aliceWallet = "0x1111111111111111111111111111111111111111"
	uint256Max  = "115792089237316195423570985008687907853269984665640564039457584007913129639935"
)

type invoiceEnv struct {
	srv          *httptest.Server
	pool         *pgxpool.Pool
	privyKey     *ecdsa.PrivateKey
	aliceProfile string // has an EVM wallet
	walletless   string // Alice's second profile, without a wallet
	bobProfile   string
}

// invoiceAPI serves the real routes on Postgres with Base Sepolia, enabled USDC and a disabled token.
func invoiceAPI(t *testing.T) invoiceEnv {
	t.Helper()
	ctx := context.Background()
	verifier, privyKey := testVerifier(t)
	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	e := invoiceEnv{pool: pool, privyKey: privyKey}
	err = pool.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true)),
		     t1 AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', $1, 'USDC', 6, true)),
		     t2 AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', '0x2222222222222222222222222222222222222222', 'OLD', 6, false)),
		     a AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     b AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:bob') RETURNING id),
		     ap AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM a RETURNING id),
		     aw AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		            SELECT id, 'privy', 'wallet-1', 'evm', $2 FROM ap),
		     a2 AS (INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM a RETURNING id),
		     bp AS (INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM b RETURNING id)
		SELECT (SELECT id::text FROM ap), (SELECT id::text FROM a2), (SELECT id::text FROM bp)`,
		usdc, aliceWallet).Scan(&e.aliceProfile, &e.walletless, &e.bobProfile)
	if err != nil {
		t.Fatal(err)
	}
	e.srv = httptest.NewServer(NewMux(pool, verifier))
	t.Cleanup(e.srv.Close)
	return e
}

type reply struct {
	status int
	body   map[string]any
}

func (e invoiceEnv) post(t *testing.T, user, profile, key, body string) reply {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, e.srv.URL+"/v1/profiles/"+profile+"/invoices", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if user != "" {
		req.Header.Set("Authorization", "Bearer "+signES256(t, e.privyKey, claims(user)))
	}
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	return e.do(t, req)
}

func (e invoiceEnv) get(t *testing.T, id string) reply {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, e.srv.URL+"/v1/invoices/"+id, nil)
	if err != nil {
		t.Fatal(err)
	}
	return e.do(t, req)
}

func (e invoiceEnv) do(t *testing.T, req *http.Request) reply {
	t.Helper()
	res, err := e.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	r := reply{status: res.StatusCode}
	if err := json.Unmarshal(raw, &r.body); err != nil {
		t.Fatalf("status %d, body not JSON: %s", res.StatusCode, raw)
	}
	return r
}

func errorCode(r reply) string {
	e, _ := r.body["error"].(map[string]any)
	code, _ := e["code"].(string)
	return code
}

const basicBody = `{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000"}`

func TestCreateInvoice(t *testing.T) {
	e := invoiceAPI(t)
	before := time.Now().UTC().Truncate(time.Second)
	r := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody)
	if r.status != http.StatusCreated {
		t.Fatalf("got %d %v", r.status, r.body)
	}
	b := r.body
	if !regexp.MustCompile(`^0x[0-9a-f]{64}$`).MatchString(b["invoiceId"].(string)) {
		t.Fatalf("invoiceId %v is not 32 bytes of hex", b["invoiceId"])
	}
	if b["recipient"] != aliceWallet || b["amount"] != "5000000" || b["token"] != usdc || b["chainId"] != float64(84532) {
		t.Fatalf("terms %v", b)
	}
	if b["paymentStatus"] != "open" || b["settlementStatus"] != "none" || b["refundStatus"] != "none" {
		t.Fatalf("statuses %v", b)
	}
	expiresAt, _ := time.Parse(time.RFC3339, b["expiresAt"].(string))
	settleDeadline, _ := time.Parse(time.RFC3339, b["settleDeadline"].(string))
	if d := expiresAt.Sub(before); d < time.Hour || d > time.Hour+5*time.Second {
		t.Fatalf("expiresAt %v is not now + 1h", expiresAt)
	}
	if settleDeadline.Sub(expiresAt) != 24*time.Hour {
		t.Fatalf("settleDeadline %v is not expiresAt + 24h", settleDeadline)
	}

	// The stored terms recompute to the receive address the API returned.
	var id, recipient, token, amount string
	var chainID, exp, deadline uint64
	err := e.pool.QueryRow(context.Background(), `SELECT id, recipient_address, token_contract, amount::text, chain_id,
		expires_at, settle_deadline FROM invoices`).Scan(&id, &recipient, &token, &amount, &chainID, &exp, &deadline)
	if err != nil {
		t.Fatal(err)
	}
	n, _ := new(big.Int).SetString(amount, 10)
	receiver, err := address.Receive(address.Terms{InvoiceID: [32]byte(unhex(t, id)), Recipient: [20]byte(unhex(t, recipient)),
		Token: [20]byte(unhex(t, token)), Amount: n, ExpiresAt: exp, SettleDeadline: deadline, IntendedChainID: chainID})
	if err != nil {
		t.Fatal(err)
	}
	if got := "0x" + hex.EncodeToString(receiver[:]); got != b["receiveAddress"] {
		t.Fatalf("receiveAddress %v, stored terms compute %s", b["receiveAddress"], got)
	}
	if b["factory"] != "0x"+hex.EncodeToString(address.Factory[:]) {
		t.Fatalf("factory %v", b["factory"])
	}

	got := e.get(t, b["invoiceId"].(string))
	if got.status != http.StatusOK {
		t.Fatalf("GET: %d %v", got.status, got.body)
	}
	for k, v := range b {
		if got.body[k] != v {
			t.Fatalf("GET %s = %v, POST gave %v", k, got.body[k], v)
		}
	}
}

func unhex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestCreateInvoiceIsIdempotent(t *testing.T) {
	e := invoiceAPI(t)
	first := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody)
	// Same values, other spacing and field order: the same request.
	again := e.post(t, "did:privy:alice", e.aliceProfile, "key-1",
		`{"amount":"5000000","token":"0x`+strings.ToUpper(usdc[2:])+`","chainId":84532}`)
	if first.status != http.StatusCreated {
		t.Fatalf("first: %d %v", first.status, first.body)
	}
	if again.status != http.StatusOK || again.body["invoiceId"] != first.body["invoiceId"] {
		t.Fatalf("same key and body: got %d %v, want 200 with invoice %v", again.status, again.body["invoiceId"], first.body["invoiceId"])
	}
	other := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", `{"chainId": 84532, "token": "`+usdc+`", "amount": "6000000"}`)
	if other.status != http.StatusConflict || errorCode(other) != "idempotency_conflict" {
		t.Fatalf("same key, other body: got %d %v", other.status, other.body)
	}
}

// Ten requests with one key at once: one invoice, one 201, the rest 200.
func TestCreateInvoiceSameKeyConcurrently(t *testing.T) {
	e := invoiceAPI(t)
	replies := make([]reply, 10)
	var wg sync.WaitGroup
	for i := range replies {
		wg.Add(1)
		go func() {
			defer wg.Done()
			replies[i] = e.post(t, "did:privy:alice", e.aliceProfile, "key-race", basicBody)
		}()
	}
	wg.Wait()
	created := 0
	for _, r := range replies {
		switch {
		case r.status == http.StatusCreated:
			created++
		case r.status != http.StatusOK:
			t.Fatalf("got %d %v", r.status, r.body)
		}
		if r.body["invoiceId"] != replies[0].body["invoiceId"] {
			t.Fatalf("two invoices for one key: %v and %v", r.body["invoiceId"], replies[0].body["invoiceId"])
		}
	}
	if created != 1 {
		t.Fatalf("%d replies were 201, want 1", created)
	}
}

func TestCreateInvoiceErrors(t *testing.T) {
	e := invoiceAPI(t)
	body := func(fields string) string { return `{"chainId": 84532, "token": "` + usdc + `", ` + fields + `}` }
	tests := []struct {
		name, user, profile, key, body string
		status                         int
		code                           string
	}{
		{"expiresIn 900", "did:privy:alice", e.aliceProfile, "k1", body(`"amount": "1", "expiresIn": 900`), 201, ""},
		{"expiresIn 365 days", "did:privy:alice", e.aliceProfile, "k2", body(`"amount": "1", "expiresIn": 31536000`), 201, ""},
		{"amount 2^256-1", "did:privy:alice", e.aliceProfile, "k3", body(`"amount": "` + uint256Max + `"`), 201, ""},
		{"expiresIn 899", "did:privy:alice", e.aliceProfile, "k4", body(`"amount": "1", "expiresIn": 899`), 422, "invalid_value"},
		{"expiresIn over 365 days", "did:privy:alice", e.aliceProfile, "k5", body(`"amount": "1", "expiresIn": 31536001`), 422, "invalid_value"},
		{"expiresIn 0", "did:privy:alice", e.aliceProfile, "k6", body(`"amount": "1", "expiresIn": 0`), 422, "invalid_value"},
		{"amount 0", "did:privy:alice", e.aliceProfile, "k7", body(`"amount": "0"`), 422, "invalid_value"},
		{"amount 2^256", "did:privy:alice", e.aliceProfile, "k8", body(`"amount": "115792089237316195423570985008687907853269984665640564039457584007913129639936"`), 422, "invalid_value"},
		{"amount with a fraction", "did:privy:alice", e.aliceProfile, "k9", body(`"amount": "1.5"`), 422, "invalid_value"},
		{"negative amount", "did:privy:alice", e.aliceProfile, "k10", body(`"amount": "-1"`), 422, "invalid_value"},
		{"unknown token", "did:privy:alice", e.aliceProfile, "k11", `{"chainId": 84532, "token": "0x3333333333333333333333333333333333333333", "amount": "1"}`, 422, "invalid_value"},
		{"disabled token", "did:privy:alice", e.aliceProfile, "k12", `{"chainId": 84532, "token": "0x2222222222222222222222222222222222222222", "amount": "1"}`, 422, "invalid_value"},
		{"unknown chain", "did:privy:alice", e.aliceProfile, "k13", `{"chainId": 1, "token": "` + usdc + `", "amount": "1"}`, 422, "invalid_value"},
		{"profile without a wallet", "did:privy:alice", e.walletless, "k14", body(`"amount": "1"`), 422, "invalid_value"},
		{"recipient in the request", "did:privy:alice", e.aliceProfile, "k15", body(`"amount": "1", "recipient": "` + aliceWallet + `"`), 400, "malformed_request"},
		{"amount as a number", "did:privy:alice", e.aliceProfile, "k16", body(`"amount": 1`), 400, "malformed_request"},
		{"two JSON objects", "did:privy:alice", e.aliceProfile, "k17", body(`"amount": "1"`) + `{}`, 400, "malformed_request"},
		{"no Idempotency-Key", "did:privy:alice", e.aliceProfile, "", body(`"amount": "1"`), 400, "malformed_request"},
		{"Idempotency-Key over 255", "did:privy:alice", e.aliceProfile, strings.Repeat("k", 256), body(`"amount": "1"`), 400, "malformed_request"},
		{"chainId above 2^63-1", "did:privy:alice", e.aliceProfile, "k20", `{"chainId": 9223372036854775808, "token": "` + usdc + `", "amount": "1"}`, 422, "invalid_value"},
		{"amount longer than 78 digits", "did:privy:alice", e.aliceProfile, "k21", body(`"amount": "` + strings.Repeat("9", 79) + `"`), 422, "invalid_value"},
		{"Idempotency-Key not UTF-8", "did:privy:alice", e.aliceProfile, "k\xff", body(`"amount": "1"`), 400, "malformed_request"},
		{"no access token", "", e.aliceProfile, "k18", body(`"amount": "1"`), 401, "unauthorized"},
		{"another user's profile", "did:privy:bob", e.aliceProfile, "k19", body(`"amount": "1"`), 403, "forbidden"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := e.post(t, tt.user, tt.profile, tt.key, tt.body)
			if r.status != tt.status || errorCode(r) != tt.code {
				t.Fatalf("got %d %q %v, want %d %q", r.status, errorCode(r), r.body, tt.status, tt.code)
			}
		})
	}
}

func TestGetInvoiceNotFound(t *testing.T) {
	e := invoiceAPI(t)
	for _, id := range []string{"0x" + strings.Repeat("ab", 32), "not-an-id"} {
		if r := e.get(t, id); r.status != http.StatusNotFound || errorCode(r) != "invoice_not_found" {
			t.Fatalf("%s: got %d %v", id, r.status, r.body)
		}
	}
}

// Terms settle() would refuse are refused here, before any payer sees the address: a wallet equal to the token.
func TestCreateInvoiceRefusesUnsettleableTerms(t *testing.T) {
	e := invoiceAPI(t)
	_, err := e.pool.Exec(context.Background(), `INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id,
		chain_family, address) VALUES ($1, 'privy', 'wallet-2', 'evm', $2)`, e.walletless, usdc)
	if err != nil {
		t.Fatal(err)
	}
	r := e.post(t, "did:privy:alice", e.walletless, "key-1", basicBody)
	if r.status != http.StatusUnprocessableEntity || errorCode(r) != "invalid_value" {
		t.Fatalf("got %d %v", r.status, r.body)
	}
}
