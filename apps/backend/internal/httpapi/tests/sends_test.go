package tests

import (
	"net/http"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/reauth"
)

// sendsAPI: Alice's freelancer wallet holds 10 tokens of a sponsored Anvil chain, and Bob is an Admin of her merchant
// profile.
func sendsAPI(t *testing.T) (invoiceEnv, string) {
	t.Helper()
	anvil := chaintest.Start(t)
	token := anvil.DeployToken()
	anvil.Mint(token, "10000000")
	anvil.Transfer(token, aliceWallet, "10000000")
	client := ethclient.NewClient(anvil.RPC)
	e := invoiceAPIChains(t, 0, webhookKey, func(uint64) (*ethclient.Client, error) { return client, nil })
	e.exec(t, `INSERT INTO chains (chain_id, chain_family, name, enabled, gas_sponsored) VALUES ($1, 'evm', 'anvil', true, true)`,
		chaintest.ChainID)
	e.exec(t, `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES ($1, 'evm', $2, 'USDC', 6, true)`, chaintest.ChainID, token)
	e.exec(t, `INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		VALUES ($1, 'privy', 'merchant-wallet', 'evm', '0x00000000000000000000000000000000000000aa')`, e.walletless)
	e.exec(t, `INSERT INTO profile_members (profile_id, user_id, role)
		SELECT $1, id, 'admin' FROM users WHERE privy_user_id = 'did:privy:bob'`, e.walletless)
	return e, token
}

// R-211, D-61: only the owner, freshly signed in, prepares a send; a team member, even an Admin, never moves money.
func TestOnlyTheOwnerPreparesAndOnlyAFreshSignInApprovesASend(t *testing.T) {
	e, token := sendsAPI(t)
	body := `{"chainId": 31337, "token": "` + token + `", "to": "0x00000000000000000000000000000000000000cc",
		"amount": "2500000"}`
	path := "/v1/profiles/" + e.aliceProfile + "/sends"

	r := e.call(t, "POST", path, "did:privy:alice", "", body)
	if r.status != http.StatusCreated || r.body["status"] != "prepared" || r.body["amount"] != "2500000" ||
		r.body["from"] != aliceWallet {
		t.Fatalf("owner: %d %v", r.status, r.body)
	}
	if fee := r.body["networkFee"].(map[string]any); fee["amount"] != "0" || fee["paidBy"] != "forwend" {
		t.Errorf("networkFee = %v", fee)
	}
	if w := r.body["warnings"].([]any); len(w) != 1 || w[0] != "newRecipient" {
		t.Errorf("warnings = %v", w)
	}
	transfer := `{"chainId": 31337, "token": "` + token + `", "toProfileId": "` + e.walletless + `", "amount": "1"}`
	if r := e.call(t, "POST", path, "did:privy:alice", "", transfer); r.status != http.StatusCreated ||
		r.body["toProfileId"] != e.walletless || r.body["to"] != "0x00000000000000000000000000000000000000aa" {
		t.Errorf("a transfer to her merchant profile: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", path, "did:privy:alice", "", `{"chainId": 31337, "token": "`+token+`",
		"to": "0x0000000000000000000000000000000000000000", "amount": "1"}`); r.status != http.StatusUnprocessableEntity ||
		errorCode(r) != "invalid_value" {
		t.Errorf("the zero address: %d %v", r.status, r.body)
	}
	// D-49: the review is only a check, so a refreshed token prepares; approving the send for signing needs a fresh
	// sign-in, and answers with the send approved.
	refreshed := e.signedAt(t, "POST", path, "did:privy:alice", signedInAt.Add(2*time.Second), body)
	if refreshed.status != http.StatusCreated {
		t.Fatalf("a refreshed token prepares: %d %v", refreshed.status, refreshed.body)
	}
	approve := path + "/" + refreshed.body["sendId"].(string) + "/approve"
	if r := e.signedAt(t, "POST", approve, "did:privy:alice", signedInAt.Add(2*time.Second), ""); r.status !=
		http.StatusUnauthorized || errorCode(r) != "reauth_required" {
		t.Errorf("a refreshed token approves: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", approve, "did:privy:alice", "", ""); r.status != http.StatusOK ||
		r.body["status"] != "approved" || r.body["sendId"] != refreshed.body["sendId"] {
		t.Errorf("a fresh sign-in approves: %d %v", r.status, r.body)
	}
	// Once: a second approve may follow a signature whose answer was lost, so it never lets the browser sign again.
	if r := e.call(t, "POST", approve, "did:privy:alice", "", ""); r.status != http.StatusConflict ||
		errorCode(r) != "send_approved" {
		t.Errorf("a second approve: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", approve, "did:privy:bob", "", ""); r.status != http.StatusForbidden {
		t.Errorf("another user approves: %d %v", r.status, r.body)
	}
	merchant := "/v1/profiles/" + e.walletless + "/sends"
	if r := e.call(t, "POST", merchant, "did:privy:bob", "", body); r.status != http.StatusForbidden {
		t.Errorf("an Admin member: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", path, "did:privy:bob", "", body); r.status != http.StatusForbidden {
		t.Errorf("another user: %d %v", r.status, r.body)
	}
	// A key never moves money: no scope has money.move, and a key can't give a fresh sign-in.
	made := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/keys", "did:privy:alice", "",
		`{"name": "Server", "scopes": ["invoices.read"]}`)
	secret, _ := made.body["secret"].(string)
	if made.status != http.StatusCreated {
		t.Fatalf("make a key: %d %v", made.status, made.body)
	}
	if r := e.withKey(t, "POST", path, secret, body); r.status != http.StatusUnauthorized &&
		r.status != http.StatusForbidden {
		t.Errorf("a secret key: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/keys", "did:privy:alice", "",
		`{"name": "Mover", "scopes": ["money.move"]}`); r.status != http.StatusUnprocessableEntity {
		t.Errorf("a key with money.move: %d %v", r.status, r.body)
	}
	// The approved send holds the wallet: its signature may have gone out though the browser lost the answer.
	if r := e.call(t, "POST", path, "did:privy:alice", "", body); r.status != http.StatusConflict ||
		errorCode(r) != "send_in_progress" {
		t.Errorf("a new send while an approved one may be on its way: %d %v", r.status, r.body)
	}
}

// R-219, D-49: the two-step methods Forwend recorded behind a fresh sign-in stand in for the emailed code on a send. A
// stolen session can set one up at Privy, but can't record it, so that one changes nothing.
func TestRecordedTwoStepStandsInForTheEmailedCodeOnASend(t *testing.T) {
	e, token := sendsAPI(t)
	path := "/v1/profiles/" + e.aliceProfile + "/sends"
	stale := signedInAt.Add(2 * time.Second)
	prepared := e.signedAt(t, "POST", path, "did:privy:alice", stale, `{"chainId": 31337, "token": "`+token+`",
		"to": "0x00000000000000000000000000000000000000cc", "amount": "2500000"}`)
	if prepared.status != http.StatusCreated {
		t.Fatalf("prepare: %d %v", prepared.status, prepared.body)
	}
	approve := path + "/" + prepared.body["sendId"].(string) + "/approve"
	atPrivy := func(methods map[string]int64) {
		e.wallets.Lock()
		e.wallets.Mfa["did:privy:alice"] = methods
		e.wallets.Unlock()
	}
	both := `{"methods": ["passkey", "totp"]}`
	wait := reauth.TwoStepWait
	t.Cleanup(func() { reauth.TwoStepWait = wait })
	reauth.TwoStepWait = time.Millisecond
	if r := e.call(t, "PUT", "/v1/me/two-step", "did:privy:alice", "", both); r.status != http.StatusConflict ||
		errorCode(r) != "two_step_not_set_up" {
		t.Errorf("record with nothing at Privy: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", "/v1/me/two-step", "did:privy:alice", "", `{"methods": ["email"]}`); r.status !=
		http.StatusBadRequest {
		t.Errorf("record an unknown method: %d %v", r.status, r.body)
	}
	atPrivy(map[string]int64{"passkey": 90, "totp": 100})
	if r := e.signedAt(t, "POST", approve, "did:privy:alice", stale, ""); r.status != http.StatusUnauthorized {
		t.Errorf("a stale session with methods set up at Privy alone approves: %d %v", r.status, r.body)
	}
	if r := e.signedAt(t, "PUT", "/v1/me/two-step", "did:privy:alice", stale, both); r.status != http.StatusUnauthorized {
		t.Errorf("a stale session records its methods: %d %v", r.status, r.body)
	}
	// Right after the setup, Privy can answer for a moment without the method added last: the record reads again
	// until it lists every method the user set up.
	atPrivy(map[string]int64{"passkey": 90})
	reauth.TwoStepWait = 50 * time.Millisecond
	go func() {
		time.Sleep(60 * time.Millisecond)
		atPrivy(map[string]int64{"passkey": 90, "totp": 100})
	}()
	if r := e.call(t, "PUT", "/v1/me/two-step", "did:privy:alice", "", both); r.status != http.StatusNoContent {
		t.Fatalf("record after a fresh sign-in, while Privy catches up: %d %v", r.status, r.body)
	}
	atPrivy(map[string]int64{"passkey": 90, "totp": 200}) // the app set up again at Privy, not recorded
	if r := e.signedAt(t, "POST", approve, "did:privy:alice", stale, ""); r.status != http.StatusUnauthorized {
		t.Errorf("a stale session with an app set up again approves: %d %v", r.status, r.body)
	}
	atPrivy(map[string]int64{"passkey": 90, "totp": 100})
	if r := e.signedAt(t, "POST", "/v1/profiles/"+e.aliceProfile+"/keys", "did:privy:alice", stale,
		`{"name": "Server", "scopes": ["invoices.read"]}`); r.status != http.StatusUnauthorized ||
		errorCode(r) != "reauth_required" {
		t.Errorf("a key made by a stale session with the recorded methods: %d %v", r.status, r.body)
	}
	if r := e.signedAt(t, "POST", approve, "did:privy:alice", stale, ""); r.status != http.StatusOK ||
		r.body["status"] != "approved" {
		t.Errorf("a stale session with the recorded methods approves: %d %v", r.status, r.body)
	}
}

// R-212: the browser reports the hash; only the owner reads and moves the send on.
func TestTheOwnerReportsAndReadsASend(t *testing.T) {
	e, token := sendsAPI(t)
	path := "/v1/profiles/" + e.aliceProfile + "/sends"
	r := e.call(t, "POST", path, "did:privy:alice", "", `{"chainId": 31337, "token": "`+token+`",
		"to": "0x00000000000000000000000000000000000000cc", "amount": "1"}`)
	if r.status != http.StatusCreated {
		t.Fatalf("prepare: %d %v", r.status, r.body)
	}
	one := path + "/" + r.body["sendId"].(string)
	hash := `{"txHash": "0x` + "ab" + "000000000000000000000000000000000000000000000000000000000000ab" + `"}`
	if r := e.call(t, "POST", one+"/submit", "did:privy:bob", "", hash); r.status != http.StatusForbidden {
		t.Errorf("another user submits: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", one+"/submit", "did:privy:alice", "", hash); r.status != http.StatusUnprocessableEntity {
		t.Errorf("a hash for a send never approved: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", one+"/approve", "did:privy:alice", "", ""); r.status != http.StatusOK {
		t.Fatalf("approve: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", one+"/submit", "did:privy:alice", "", hash); r.status != http.StatusOK ||
		r.body["status"] != "sending" || r.body["final"] != false {
		t.Errorf("submit: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", one, "did:privy:alice", "", ""); r.status != http.StatusOK || r.body["status"] != "sending" {
		t.Errorf("read: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", one+"/cancel", "did:privy:alice", "", ""); r.status != http.StatusUnprocessableEntity {
		t.Errorf("cancel a signed send: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", path+"/00000000-0000-0000-0000-000000000000", "did:privy:alice", "", ""); r.status !=
		http.StatusNotFound || errorCode(r) != "send_not_found" {
		t.Errorf("unknown send: %d %v", r.status, r.body)
	}
}
