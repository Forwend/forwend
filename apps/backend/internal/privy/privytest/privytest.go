// Package privytest is a fake Privy wallet API for tests: create and list wallets, unique external_id per app,
// owner filter, and cached errors replayed per idempotency key like Privy; wallet RPC requests and their transactions.
package privytest

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	AppID     = "app-1"
	AppSecret = "secret-1"
)

type Fake struct {
	URL string

	mu      sync.Mutex
	t       *testing.T
	wallets map[string]map[string]any
	Creates []map[string]any // POST bodies, in order
	Keys    []string         // privy-idempotency-key headers, in order
	// HideOnce makes the next list miss an existing wallet, as when another request created it in between.
	HideOnce bool
	// FailCreates answers that many creates with 500; an error for an idempotency key is replayed for that key.
	FailCreates int
	failedKeys  map[string]bool
	// Delay holds every answer that long (or until the caller gives up), like a slow Privy.
	Delay time.Duration
	// Emails are the users' verified email accounts by Privy user ID; UserReads counts GET /v1/users/{id}.
	Emails    map[string]string
	UserReads int
	// FailUserReads answers that many user reads with 500.
	FailUserReads int
	// SignedInAt is a user's email latest_verified_at (1 when unset). PasskeySignIn, when set, gives every user a
	// passkey account verified at that time.
	SignedInAt    map[string]int64
	PasskeySignIn int64
	// LinkedAt is a user's email first_verified_at (1 when unset); PasskeyLinkedAt is the passkey's. CreatedAt is every
	// user's created_at (1 when unset).
	LinkedAt        map[string]int64
	PasskeyLinkedAt int64
	CreatedAt       int64
	// Mfa is each user's MFA methods at Privy: verified_at by type (totp, passkey).
	Mfa map[string]map[string]int64
	// GoogleSignIn, when set, gives every user a Google account verified at that time.
	GoogleSignIn int64
	// Freezes lists "freeze <id>" and "unfreeze <id>" calls in order. FailFreezes and FailUnfreezes answer that many
	// freezes and unfreezes with 500; the calls are listed either way.
	Freezes       []string
	FailFreezes   int
	FailUnfreezes int
	// RPCs are the wallet RPC requests in order. Each answers transaction "tx-" plus its idempotency key, whose hash is
	// Hashes' entry, else none yet; Statuses' entry is its status, else broadcasted. A transaction names the wallet,
	// caip2 and reference_id of its request, unless Owners overrides its wallet. FailTransactions answers every read
	// with 500.
	RPCs             []RPC
	Hashes           map[string]string
	Statuses         map[string]string
	Owners           map[string]string
	FailTransactions bool
	sent             map[string]map[string]any
}

// RPC is a wallet RPC request as Privy got it.
type RPC struct {
	Path    string
	Body    []byte
	Headers http.Header
}

func New(t *testing.T) *Fake {
	f := &Fake{t: t, wallets: map[string]map[string]any{}, failedKeys: map[string]bool{}, Emails: map[string]string{},
		SignedInAt: map[string]int64{}, LinkedAt: map[string]int64{}, Mfa: map[string]map[string]int64{},
		Hashes: map[string]string{}, Statuses: map[string]string{}, Owners: map[string]string{},
		sent: map[string]map[string]any{}}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	f.URL = srv.URL
	return f
}

func (f *Fake) Wallets() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.wallets)
}

// Lock and Unlock let a test change the knobs safely while requests run.
func (f *Fake) Lock()   { f.mu.Lock() }
func (f *Fake) Unlock() { f.mu.Unlock() }

func (f *Fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Basic "+base64.StdEncoding.EncodeToString([]byte(AppID+":"+AppSecret)) ||
		r.Header.Get("privy-app-id") != AppID {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	f.mu.Lock()
	delay := f.Delay
	f.mu.Unlock()
	select {
	case <-time.After(delay):
	case <-r.Context().Done():
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/v1/wallets":
		data := []any{}
		wallet, ok := f.wallets[r.URL.Query().Get("external_id")]
		owner := r.URL.Query().Get("user_id")
		if ok && !f.HideOnce && (owner == "" || wallet["owner_user"] == owner) {
			data = append(data, wallet)
		}
		f.HideOnce = false
		_ = json.NewEncoder(w).Encode(map[string]any{"data": data, "next_cursor": nil})
	case r.Method == http.MethodPost && r.URL.Path == "/v1/wallets":
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			f.t.Error(err)
		}
		f.Creates = append(f.Creates, body)
		key := r.Header.Get("privy-idempotency-key")
		f.Keys = append(f.Keys, key)
		if (key != "" && f.failedKeys[key]) || f.FailCreates > 0 {
			f.FailCreates--
			if key != "" {
				f.failedKeys[key] = true
			}
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"internal"}`))
			return
		}
		ext, _ := body["external_id"].(string)
		if _, taken := f.wallets[ext]; taken {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"external_id already exists"}`))
			return
		}
		owner, _ := body["owner"].(map[string]any)
		n := len(f.wallets) + 1
		wallet := map[string]any{"id": fmt.Sprintf("wallet-%d", n), "chain_type": "ethereum", "owner_user": owner["user_id"],
			"address": fmt.Sprintf("0xAbCdEf%034x", n), "external_id": ext, "created_at": 1, "owner_id": nil,
			"policy_ids": []any{}, "additional_signers": []any{}}
		f.wallets[ext] = wallet
		_ = json.NewEncoder(w).Encode(wallet)
	case strings.HasPrefix(r.URL.Path, "/v1/users/") && strings.HasSuffix(r.URL.Path, "/freeze"):
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/users/"), "/freeze")
		call, fails := "freeze ", &f.FailFreezes
		if r.Method == http.MethodDelete {
			call, fails = "unfreeze ", &f.FailUnfreezes
		}
		f.Freezes = append(f.Freezes, call+id)
		if *fails > 0 {
			*fails--
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/users/"):
		f.UserReads++
		if f.FailUserReads > 0 {
			f.FailUserReads--
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/v1/users/")
		accounts := []any{}
		if email, ok := f.Emails[id]; ok {
			at := f.SignedInAt[id]
			if at == 0 {
				at = 1
			}
			linked := f.LinkedAt[id]
			if linked == 0 {
				linked = 1
			}
			accounts = append(accounts, map[string]any{"type": "email", "address": email, "first_verified_at": linked,
				"latest_verified_at": at, "verified_at": 1})
		}
		if f.GoogleSignIn != 0 {
			accounts = append(accounts, map[string]any{"type": "google_oauth", "email": "g@example.com",
				"subject": "g-1", "name": "G", "first_verified_at": 1, "latest_verified_at": f.GoogleSignIn,
				"verified_at": 1})
		}
		if f.PasskeySignIn != 0 {
			linked := f.PasskeyLinkedAt
			if linked == 0 {
				linked = 1
			}
			accounts = append(accounts, map[string]any{"type": "passkey", "credential_id": "cred-1",
				"first_verified_at": linked, "latest_verified_at": f.PasskeySignIn, "verified_at": 1})
		}
		created := f.CreatedAt
		if created == 0 {
			created = 1
		}
		mfa := []any{}
		for kind, at := range f.Mfa[id] {
			mfa = append(mfa, map[string]any{"type": kind, "verified_at": at})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "created_at": created, "has_accepted_terms": true,
			"is_guest": false, "linked_accounts": accounts, "mfa_methods": mfa})
	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v1/wallets/") && strings.HasSuffix(r.URL.Path, "/rpc"):
		body, err := io.ReadAll(r.Body)
		if err != nil {
			f.t.Error(err)
		}
		f.RPCs = append(f.RPCs, RPC{Path: r.URL.Path, Body: body, Headers: r.Header.Clone()})
		id := "tx-" + r.Header.Get("privy-idempotency-key")
		var req map[string]any
		_ = json.Unmarshal(body, &req)
		f.sent[id] = map[string]any{"wallet_id": strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/wallets/"), "/rpc"),
			"caip2": req["caip2"], "reference_id": req["reference_id"]}
		_ = json.NewEncoder(w).Encode(map[string]any{"method": "eth_sendTransaction",
			"data": map[string]any{"caip2": "eip155:1", "hash": "", "transaction_id": id}})
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/transactions/"):
		if f.FailTransactions {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/v1/transactions/")
		sent := f.sent[id]
		if sent == nil {
			sent = map[string]any{}
		}
		if owner, ok := f.Owners[id]; ok {
			sent["wallet_id"] = owner
		}
		status := f.Statuses[id]
		if status == "" {
			status = "broadcasted"
		}
		var hash any
		if h, ok := f.Hashes[id]; ok {
			hash = h
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "caip2": sent["caip2"], "created_at": 1, "status": status,
			"transaction_hash": hash, "wallet_id": sent["wallet_id"], "reference_id": sent["reference_id"]})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}
