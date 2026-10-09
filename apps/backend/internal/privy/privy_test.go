package privy

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

const (
	appID     = "app-1"
	appSecret = "secret-1"
	user      = "did:privy:alice"
	profile   = "0b7c6a52-5a5c-4f4e-9a8e-1c2d3e4f5a6b"
)

// fakePrivy serves the two wallet endpoints the wrapper uses, enforcing unique external_id like Privy.
type fakePrivy struct {
	t       *testing.T
	mu      sync.Mutex
	wallets map[string]map[string]any // by external_id
	creates []map[string]any          // POST bodies
	keys    []string                  // privy-idempotency-key headers
	// hideOnce makes the next list miss an existing wallet, as when another request created it in between.
	hideOnce bool
	// failCreates answers that many creates with 500. Like Privy, an error for an idempotency key is replayed for
	// that key afterwards.
	failCreates int
	failedKeys  map[string]bool
}

func newFake(t *testing.T) (*fakePrivy, *Client) {
	f := &fakePrivy{t: t, wallets: map[string]map[string]any{}, failedKeys: map[string]bool{}}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return f, NewClient(appID, appSecret, srv.URL)
}

func (f *fakePrivy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Basic "+base64.StdEncoding.EncodeToString([]byte(appID+":"+appSecret)) ||
		r.Header.Get("privy-app-id") != appID {
		w.WriteHeader(http.StatusUnauthorized)
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
		if ok && !f.hideOnce && (owner == "" || wallet["owner_user"] == owner) {
			data = append(data, wallet)
		}
		f.hideOnce = false
		_ = json.NewEncoder(w).Encode(map[string]any{"data": data, "next_cursor": nil})
	case r.Method == http.MethodPost && r.URL.Path == "/v1/wallets":
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			f.t.Error(err)
		}
		f.creates = append(f.creates, body)
		key := r.Header.Get("privy-idempotency-key")
		f.keys = append(f.keys, key)
		if (key != "" && f.failedKeys[key]) || f.failCreates > 0 {
			f.failCreates--
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
		wallet := map[string]any{"id": fmt.Sprintf("wallet-%d", len(f.wallets)+1), "chain_type": "ethereum",
			"owner_user": owner["user_id"],
			"address":    "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01", "external_id": ext, "created_at": 1, "owner_id": nil,
			"policy_ids": []any{}, "additional_signers": []any{}}
		f.wallets[ext] = wallet
		_ = json.NewEncoder(w).Encode(wallet)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func TestProfileWalletIsCreatedOnceAndFoundAgain(t *testing.T) {
	f, c := newFake(t)
	ctx := context.Background()
	first, err := c.ProfileWallet(ctx, user, profile)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != "wallet-1" || first.Address != "0xabcdef0123456789abcdef0123456789abcdef01" {
		t.Fatalf("got %+v, want wallet-1 with a lowercase address", first)
	}
	if len(f.creates) != 1 {
		t.Fatalf("%d creates, want 1", len(f.creates))
	}
	body := f.creates[0]
	owner, _ := body["owner"].(map[string]any)
	if body["chain_type"] != "ethereum" || body["external_id"] != profile || owner["user_id"] != user {
		t.Fatalf("create body %v: want an ethereum wallet owned by the user with external_id = profile id", body)
	}

	again, err := c.ProfileWallet(ctx, user, profile)
	if err != nil || again != first || len(f.creates) != 1 {
		t.Fatalf("second call: %+v, %v, %d creates; want the same wallet and no new create", again, err, len(f.creates))
	}
}

// Another request created the wallet between our lookup and our create: Privy refuses the duplicate, and the
// existing wallet is returned.
func TestProfileWalletLosesTheCreateRace(t *testing.T) {
	f, c := newFake(t)
	ctx := context.Background()
	theirs, err := c.ProfileWallet(ctx, user, profile)
	if err != nil {
		t.Fatal(err)
	}
	f.hideOnce = true
	ours, err := c.ProfileWallet(ctx, user, profile)
	if err != nil || ours != theirs || len(f.wallets) != 1 {
		t.Fatalf("got %+v, %v with %d wallets; want the existing wallet", ours, err, len(f.wallets))
	}
}

func TestProfileWalletConcurrentCallsMakeOneWallet(t *testing.T) {
	f, c := newFake(t)
	var wg sync.WaitGroup
	got := make([]Wallet, 10)
	for i := range got {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w, err := c.ProfileWallet(context.Background(), user, profile)
			if err != nil {
				t.Error(err)
			}
			got[i] = w
		}()
	}
	wg.Wait()
	for _, w := range got {
		if w != got[0] {
			t.Fatalf("two wallets for one profile: %+v and %+v", w, got[0])
		}
	}
	if len(f.wallets) != 1 {
		t.Fatalf("%d wallets in Privy, want 1", len(f.wallets))
	}
}

func TestProfileWalletReportsPrivyErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer srv.Close()
	c := NewClient(appID, "wrong-secret", srv.URL)
	if _, err := c.ProfileWallet(context.Background(), user, profile); err == nil {
		t.Fatal("a Privy error was swallowed")
	}
}

// A Privy error during create is reported, and the next call creates the wallet: no cached error blocks it.
func TestProfileWalletRecoversFromAFailedCreate(t *testing.T) {
	f, c := newFake(t)
	ctx := context.Background()
	f.failCreates = 3 // the first call and the SDK's two retries
	if _, err := c.ProfileWallet(ctx, user, profile); err == nil {
		t.Fatal("a failed create was not reported")
	}
	w, err := c.ProfileWallet(ctx, user, profile)
	if err != nil || w.ID != "wallet-1" {
		t.Fatalf("next call: %+v, %v; want the wallet created", w, err)
	}
}

// Another user asking for this profile's wallet gets an error, never the owner's wallet.
func TestProfileWalletBelongsToItsUser(t *testing.T) {
	_, c := newFake(t)
	ctx := context.Background()
	if _, err := c.ProfileWallet(ctx, user, profile); err != nil {
		t.Fatal(err)
	}
	if w, err := c.ProfileWallet(ctx, "did:privy:mallory", profile); err == nil {
		t.Fatalf("another user got %+v", w)
	}
}
