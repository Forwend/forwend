// Package privytest is a fake Privy wallet API for tests: create and list wallets, unique external_id per app,
// owner filter, and cached errors replayed per idempotency key like Privy.
package privytest

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// AppID and AppSecret are what the fake accepts.
const (
	AppID     = "app-1"
	AppSecret = "secret-1"
)

// Fake records requests and holds wallets by external_id.
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
}

// New starts the fake until the test ends.
func New(t *testing.T) *Fake {
	f := &Fake{t: t, wallets: map[string]map[string]any{}, failedKeys: map[string]bool{}, Emails: map[string]string{}}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	f.URL = srv.URL
	return f
}

// Wallets is the number of wallets held.
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
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/users/"):
		f.UserReads++
		id := strings.TrimPrefix(r.URL.Path, "/v1/users/")
		accounts := []any{}
		if email, ok := f.Emails[id]; ok {
			accounts = append(accounts, map[string]any{"type": "email", "address": email, "first_verified_at": 1,
				"latest_verified_at": 1, "verified_at": 1})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "created_at": 1, "has_accepted_terms": true,
			"is_guest": false, "linked_accounts": accounts, "mfa_methods": []any{}})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}
