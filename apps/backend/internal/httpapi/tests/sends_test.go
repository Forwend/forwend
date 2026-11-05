package tests

import (
	"net/http"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
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
func TestOnlyTheOwnerWithAFreshSignInPreparesASend(t *testing.T) {
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
	if r := e.signedAt(t, "POST", path, "did:privy:alice", signedInAt.Add(2*time.Second), body); r.status !=
		http.StatusUnauthorized || errorCode(r) != "reauth_required" {
		t.Errorf("a refreshed token: %d %v", r.status, r.body)
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
