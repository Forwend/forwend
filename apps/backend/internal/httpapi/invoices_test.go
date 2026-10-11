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
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
	"github.com/ensp1re/forwend/apps/backend/internal/privy/privytest"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	usdc        = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
	aliceWallet = "0x1111111111111111111111111111111111111111"
	uint256Max  = "115792089237316195423570985008687907853269984665640564039457584007913129639935"
	webURL      = "https://forwend.test"
)

type invoiceEnv struct {
	srv          *httptest.Server
	pool         *pgxpool.Pool
	wallets      *privytest.Fake
	privyKey     *ecdsa.PrivateKey
	aliceProfile string // has an EVM wallet
	walletless   string // Alice's second profile, without a wallet
	bobProfile   string
}

// invoiceAPI serves the real routes on Postgres, a fake Privy and wallet balances of 2500000 at block 100, with Base Sepolia, enabled USDC and a disabled token.
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
	e := invoiceEnv{pool: pool, privyKey: privyKey, wallets: privytest.New(t)}
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
		            SELECT id, 'privy', 'fixture-wallet', 'evm', $2 FROM ap),
		     a2 AS (INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM a RETURNING id),
		     bp AS (INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM b RETURNING id)
		SELECT (SELECT id::text FROM ap), (SELECT id::text FROM a2), (SELECT id::text FROM bp)`,
		usdc, aliceWallet).Scan(&e.aliceProfile, &e.walletless, &e.bobProfile)
	if err != nil {
		t.Fatal(err)
	}
	e.srv = httptest.NewServer(NewMux(pool, verifier, privy.NewClient(privytest.AppID, privytest.AppSecret, e.wallets.URL),
		func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
			return big.NewInt(2500000), 100, nil
		}, webURL))
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
	if b["paymentStatus"] != "open" || b["settlementStatus"] != "none" || b["refundStatus"] != "none" ||
		b["settlementTxHash"] != nil {
		t.Fatalf("statuses %v", b)
	}
	if b["number"] != float64(1) || b["title"] != nil || b["note"] != nil || b["dueDate"] != nil || b["senderName"] != nil ||
		!reflect.DeepEqual(b["client"], map[string]any{"name": nil, "email": nil, "address": nil}) {
		t.Fatalf("number and details %v", b)
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
		if !reflect.DeepEqual(got.body[k], v) && k != "client" {
			t.Fatalf("GET %s = %v, POST gave %v", k, got.body[k], v)
		}
	}
	if _, ok := got.body["client"]; ok {
		t.Fatalf("the public GET shows the client: %v", got.body["client"])
	}
}

const detailsBody = `{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000", "title": "Logo design",
	"note": "Thanks!\nPay within 14 days.", "dueDate": "2026-11-01", "senderName": "Alice Design",
	"client": {"name": "Bob Ltd", "email": "bob@example.com", "address": "Main St 1\nBerlin"}}`

// The details are stored and returned to the owner; the public GET gives the payer the number, title, note, due date
// and sender name, never the client's contact details.
func TestCreateInvoiceStoresDetails(t *testing.T) {
	e := invoiceAPI(t)
	r := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", detailsBody)
	if r.status != http.StatusCreated {
		t.Fatalf("got %d %v", r.status, r.body)
	}
	want := map[string]any{"number": float64(1), "title": "Logo design", "note": "Thanks!\nPay within 14 days.",
		"dueDate": "2026-11-01", "senderName": "Alice Design",
		"client": map[string]any{"name": "Bob Ltd", "email": "bob@example.com", "address": "Main St 1\nBerlin"}}
	for k, v := range want {
		if !reflect.DeepEqual(r.body[k], v) {
			t.Fatalf("%s = %v, want %v", k, r.body[k], v)
		}
	}
	again := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", detailsBody)
	if again.status != http.StatusOK || again.body["invoiceId"] != r.body["invoiceId"] || again.body["number"] != float64(1) {
		t.Fatalf("same key and body: %d %v", again.status, again.body)
	}
	for _, edit := range [][2]string{{"Logo", "Icon"}, {"Alice Design", "Alice"}} {
		other := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", strings.Replace(detailsBody, edit[0], edit[1], 1))
		if other.status != http.StatusConflict || errorCode(other) != "idempotency_conflict" {
			t.Fatalf("same key, %s changed: %d %v", edit[0], other.status, other.body)
		}
	}

	public := e.get(t, r.body["invoiceId"].(string))
	if _, ok := public.body["client"]; public.status != http.StatusOK || ok {
		t.Fatalf("public GET: %d %v; want 200 without the client", public.status, public.body)
	}
	for k, v := range want {
		if k != "client" && !reflect.DeepEqual(public.body[k], v) {
			t.Fatalf("public GET %s = %v, want %v", k, public.body[k], v)
		}
	}
}

// An invoice keeps the billing details the profile had when it was made: editing them later changes no invoice, and a
// profile without them gives invoices no issuer (R-43).
func TestInvoiceKeepsItsIssuerCopy(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	none := e.post(t, alice, e.aliceProfile, "key-1", basicBody)
	if v, ok := none.body["issuer"]; none.status != http.StatusCreated || !ok || v != nil {
		t.Fatalf("no billing details: %d %v; want issuer null", none.status, none.body)
	}

	details := "/v1/profiles/" + e.aliceProfile + "/billing-details"
	if r := e.call(t, "PUT", details, alice, "", billingBody); r.status != http.StatusOK {
		t.Fatalf("PUT: %d %v", r.status, r.body)
	}
	old := map[string]any{"name": "Alice Design GmbH", "address": "Hauptstr. 1\n10115 Berlin", "country": "DE",
		"taxId": "DE123456789", "email": "billing@alice.example"}
	made := e.post(t, alice, e.aliceProfile, "key-2", basicBody)
	if made.status != http.StatusCreated || !reflect.DeepEqual(made.body["issuer"], old) {
		t.Fatalf("create: %d issuer %v, want %v", made.status, made.body["issuer"], old)
	}
	if r := e.call(t, "PUT", details, alice, "", `{"name": "Alice Studio", "address": "Rue 2, Paris", "country": "FR",
		"email": "studio@alice.example"}`); r.status != http.StatusOK {
		t.Fatalf("second PUT: %d %v", r.status, r.body)
	}

	id := made.body["invoiceId"].(string)
	if public := e.get(t, id); public.status != http.StatusOK || !reflect.DeepEqual(public.body["issuer"], old) {
		t.Fatalf("public GET after the edit: %d issuer %v, want %v", public.status, public.body["issuer"], old)
	}
	if again := e.post(t, alice, e.aliceProfile, "key-2", basicBody); again.status != http.StatusOK ||
		again.body["invoiceId"] != id || !reflect.DeepEqual(again.body["issuer"], old) {
		t.Fatalf("same key after the edit: %d %v; want the stored invoice with the old issuer", again.status, again.body)
	}
	items := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices", alice, "", "").body["items"].([]any)
	if got := items[0].(map[string]any)["issuer"]; !reflect.DeepEqual(got, old) {
		t.Fatalf("list after the edit: issuer %v, want %v", got, old)
	}
	if got := items[1].(map[string]any)["issuer"]; got != nil {
		t.Fatalf("list: the invoice made without details has issuer %v", got)
	}
	newer := e.post(t, alice, e.aliceProfile, "key-3", basicBody)
	if want := map[string]any{"name": "Alice Studio", "address": "Rue 2, Paris", "country": "FR", "taxId": nil,
		"email": "studio@alice.example"}; !reflect.DeepEqual(newer.body["issuer"], want) {
		t.Fatalf("invoice after the edit: issuer %v, want %v", newer.body["issuer"], want)
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
		{"longest texts", "did:privy:alice", e.aliceProfile, "k22", body(`"amount": "1", "title": "` + strings.Repeat("é", 200) +
			`", "note": "` + strings.Repeat("n", 2000) + `", "client": {"name": "` + strings.Repeat("c", 200) +
			`", "email": "` + strings.Repeat("e", 242) + `@example.com", "address": "` + strings.Repeat("a", 500) +
			`"}, "senderName": "` + strings.Repeat("s", 100) + `"`), 201, ""},
		{"title over 200", "did:privy:alice", e.aliceProfile, "k23", body(`"amount": "1", "title": "` + strings.Repeat("é", 201) + `"`), 422, "invalid_value"},
		{"note over 2000", "did:privy:alice", e.aliceProfile, "k24", body(`"amount": "1", "note": "` + strings.Repeat("n", 2001) + `"`), 422, "invalid_value"},
		{"client name over 200", "did:privy:alice", e.aliceProfile, "k25", body(`"amount": "1", "client": {"name": "` + strings.Repeat("c", 201) + `"}`), 422, "invalid_value"},
		{"client email over 254", "did:privy:alice", e.aliceProfile, "k26", body(`"amount": "1", "client": {"email": "` + strings.Repeat("e", 243) + `@example.com"}`), 422, "invalid_value"},
		{"client address over 500", "did:privy:alice", e.aliceProfile, "k27", body(`"amount": "1", "client": {"address": "` + strings.Repeat("a", 501) + `"}`), 422, "invalid_value"},
		{"client email without @", "did:privy:alice", e.aliceProfile, "k28", body(`"amount": "1", "client": {"email": "bob.example.com"}`), 422, "invalid_value"},
		{"client email with a name", "did:privy:alice", e.aliceProfile, "k29", body(`"amount": "1", "client": {"email": "Bob <bob@example.com>"}`), 422, "invalid_value"},
		{"title with a NUL", "did:privy:alice", e.aliceProfile, "k30", body(`"amount": "1", "title": "a\u0000b"`), 422, "invalid_value"},
		{"senderName over 100", "did:privy:alice", e.aliceProfile, "k35", body(`"amount": "1", "senderName": "` + strings.Repeat("é", 101) + `"`), 422, "invalid_value"},
		{"senderName with a NUL", "did:privy:alice", e.aliceProfile, "k36", body(`"amount": "1", "senderName": "a\u0000b"`), 422, "invalid_value"},
		{"dueDate not a day", "did:privy:alice", e.aliceProfile, "k31", body(`"amount": "1", "dueDate": "2026-02-30"`), 422, "invalid_value"},
		{"dueDate with a time", "did:privy:alice", e.aliceProfile, "k32", body(`"amount": "1", "dueDate": "2026-11-01T00:00:00Z"`), 422, "invalid_value"},
		{"dueDate year 0", "did:privy:alice", e.aliceProfile, "k33", body(`"amount": "1", "dueDate": "0000-01-01"`), 422, "invalid_value"},
		{"unknown client field", "did:privy:alice", e.aliceProfile, "k34", body(`"amount": "1", "client": {"phone": "1"}`), 400, "malformed_request"},
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

// GET lists deposits that are not reorged with their sender and block time; a detected one shows how far the
// finalized block still has to go. The owner's route lists the same deposits.
func TestGetInvoiceListsDepositsWithProgress(t *testing.T) {
	e := invoiceAPI(t)
	created := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody)
	id, receive := created.body["invoiceId"].(string), created.body["receiveAddress"].(string)
	expires, _ := time.Parse(time.RFC3339, created.body["expiresAt"].(string))
	payer := "0x" + strings.Repeat("ab", 20)
	_, err := e.pool.Exec(context.Background(), `
		WITH cur AS (INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block, last_finalized_time)
		             VALUES (84532, 1000, 980, $4))
		INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index, block_hash,
		    block_number, block_time, from_address, to_address, amount, status)
		VALUES (84532, 'evm', $1, $2, '0x' || repeat('01', 32), 0, '0x' || repeat('01', 32), 970, $4 - 20, $5, $3, 2000000, 'confirmed'),
		       (84532, 'evm', $1, $2, '0x' || repeat('02', 32), 1, '0x' || repeat('02', 32), 1000, $4 + 40, $3, $3, 1000000, 'detected'),
		       (84532, 'evm', $1, $2, '0x' || repeat('03', 32), 2, '0x' || repeat('03', 32), 999, $4 + 38, $3, $3, 7000000, 'reorged')`,
		usdc, id, receive, expires.Unix()-100, payer)
	if err != nil {
		t.Fatal(err)
	}
	r := e.get(t, id)
	deposits, _ := r.body["deposits"].([]any)
	if r.status != http.StatusOK || len(deposits) != 2 {
		t.Fatalf("got %d %v", r.status, r.body["deposits"])
	}
	final, pending := deposits[0].(map[string]any), deposits[1].(map[string]any)
	if final["status"] != "confirmed" || final["amount"] != "2000000" || final["blocksLeft"] != float64(0) ||
		final["secondsLeft"] != float64(0) || final["late"] != false || final["from"] != payer ||
		final["blockTime"] != time.Unix(expires.Unix()-120, 0).UTC().Format(time.RFC3339) {
		t.Fatalf("final deposit %v", final)
	}
	if pending["status"] != "detected" || pending["blocksLeft"] != float64(20) || pending["secondsLeft"] != float64(40) ||
		pending["txHash"] != "0x"+strings.Repeat("02", 32) || pending["late"] != false || pending["from"] != receive ||
		pending["blockTime"] != time.Unix(expires.Unix()-60, 0).UTC().Format(time.RFC3339) {
		t.Fatalf("pending deposit %v", pending)
	}
	owner := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id, "did:privy:alice", "", "")
	if !reflect.DeepEqual(owner.body["deposits"], r.body["deposits"]) {
		t.Fatalf("owner deposits %v, public %v", owner.body["deposits"], r.body["deposits"])
	}
	if fresh := e.get(t, e.post(t, "did:privy:alice", e.aliceProfile, "key-2", basicBody).body["invoiceId"].(string)); !reflect.DeepEqual(fresh.body["deposits"], []any{}) {
		t.Fatalf("no deposits should be [], got %v", fresh.body["deposits"])
	}
}

// The owner lists the profile's invoices newest first in cursor pages, with client details and, once settled, the
// settlement transaction hash.
func TestListInvoices(t *testing.T) {
	e := invoiceAPI(t)
	path := "/v1/profiles/" + e.aliceProfile + "/invoices"
	empty := e.call(t, "GET", path, "did:privy:alice", "", "")
	if empty.status != http.StatusOK || !reflect.DeepEqual(empty.body, map[string]any{"items": []any{}, "nextCursor": nil}) {
		t.Fatalf("new profile: %d %v", empty.status, empty.body)
	}
	var ids []any
	for _, key := range []string{"key-1", "key-2", "key-3"} {
		ids = append(ids, e.post(t, "did:privy:alice", e.aliceProfile, key, detailsBody).body["invoiceId"])
	}

	var got []any
	cursor := ""
	for page := 1; ; page++ {
		r := e.call(t, "GET", path+"?limit=2&cursor="+cursor, "did:privy:alice", "", "")
		items, _ := r.body["items"].([]any)
		if r.status != http.StatusOK || len(items) != []int{2, 1}[page-1] {
			t.Fatalf("page %d: %d %v", page, r.status, r.body)
		}
		for _, it := range items {
			item := it.(map[string]any)
			if _, ok := item["deposits"]; ok || item["title"] != "Logo design" || item["senderName"] != "Alice Design" ||
				item["client"].(map[string]any)["email"] != "bob@example.com" {
				t.Fatalf("item %v", item)
			}
			got = append(got, item["number"], item["invoiceId"])
		}
		next, _ := r.body["nextCursor"].(string)
		if next == "" {
			break
		}
		cursor = next
	}
	if want := []any{float64(3), ids[2], float64(2), ids[1], float64(1), ids[0]}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v\nwant %v", got, want)
	}

	// A sent settle is not a settlement yet; a confirmed one shows its hash in the list and the public GET.
	first := ids[0].(string)
	sent, settled := "0x"+strings.Repeat("0a", 32), "0x"+strings.Repeat("0b", 32)
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO settlement_intents (invoice_id, status, nonce, tx_hash, raw_tx)
		VALUES ($1, 'sent', 0, $2, '\x00')`, first, sent); err != nil {
		t.Fatal(err)
	}
	hashes := func() (list, public any) {
		items := e.call(t, "GET", path, "did:privy:alice", "", "").body["items"].([]any)
		return items[2].(map[string]any)["settlementTxHash"], e.get(t, first).body["settlementTxHash"]
	}
	if list, public := hashes(); list != nil || public != nil {
		t.Fatalf("sent: settlementTxHash %v in the list, %v in GET; want null", list, public)
	}
	if _, err := e.pool.Exec(context.Background(), `
		WITH i AS (UPDATE settlement_intents SET status = 'confirmed', tx_hash = $2 WHERE invoice_id = $1)
		UPDATE invoices SET settlement_status = 'settled' WHERE id = $1`, first, settled); err != nil {
		t.Fatal(err)
	}
	if list, public := hashes(); list != settled || public != settled {
		t.Fatalf("settled: settlementTxHash %v in the list, %v in GET; want %s", list, public, settled)
	}

	for _, c := range []struct {
		query, code string
		status      int
	}{
		{"?limit=x", "malformed_request", http.StatusBadRequest},
		{"?limit=0", "invalid_value", http.StatusUnprocessableEntity},
		{"?limit=101", "invalid_value", http.StatusUnprocessableEntity},
		{"?cursor=nope", "invalid_value", http.StatusUnprocessableEntity},
	} {
		if r := e.call(t, "GET", path+c.query, "did:privy:alice", "", ""); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("%s: %d %v, want %d %s", c.query, r.status, r.body, c.status, c.code)
		}
	}
	if r := e.call(t, "GET", path, "", "", ""); r.status != http.StatusUnauthorized {
		t.Fatalf("without a token: %d", r.status)
	}
	if r := e.call(t, "GET", path, "did:privy:bob", "", ""); r.status != http.StatusForbidden || errorCode(r) != "forbidden" {
		t.Fatalf("Bob: %d %v, want 403", r.status, r.body)
	}
}

// The owner reads one invoice of the profile as the public GET does, with the client's details; an invoice of another
// profile, even the user's own, is not found there, and another user's profile is forbidden.
func TestGetProfileInvoice(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", detailsBody).body["invoiceId"].(string)
	path := func(profile, invoice string) string { return "/v1/profiles/" + profile + "/invoices/" + invoice }

	r := e.call(t, "GET", path(e.aliceProfile, id), "did:privy:alice", "", "")
	if r.status != http.StatusOK {
		t.Fatalf("owner: %d %v", r.status, r.body)
	}
	public := e.get(t, id)
	for k, v := range public.body {
		if !reflect.DeepEqual(r.body[k], v) {
			t.Fatalf("%s = %v, public GET gives %v", k, r.body[k], v)
		}
	}
	if want := map[string]any{"name": "Bob Ltd", "email": "bob@example.com", "address": "Main St 1\nBerlin"}; !reflect.DeepEqual(r.body["client"], want) {
		t.Fatalf("client %v, want %v", r.body["client"], want)
	}

	for _, c := range []struct {
		name, profile, invoice, user, code string
		status                             int
	}{
		{"another profile of the user", e.walletless, id, "did:privy:alice", "invoice_not_found", http.StatusNotFound},
		{"missing", e.aliceProfile, "0x" + strings.Repeat("ab", 32), "did:privy:alice", "invoice_not_found", http.StatusNotFound},
		{"not an id", e.aliceProfile, "not-an-id", "did:privy:alice", "invoice_not_found", http.StatusNotFound},
		{"another user", e.aliceProfile, id, "did:privy:bob", "forbidden", http.StatusForbidden},
	} {
		if r := e.call(t, "GET", path(c.profile, c.invoice), c.user, "", ""); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("%s: %d %v, want %d %s", c.name, r.status, r.body, c.status, c.code)
		}
	}
	if r := e.call(t, "GET", path(e.aliceProfile, id), "", "", ""); r.status != http.StatusUnauthorized {
		t.Fatalf("without a token: %d", r.status)
	}
}
