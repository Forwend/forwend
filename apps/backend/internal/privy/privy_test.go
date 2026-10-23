package privy

import (
	"context"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/privy/privytest"
)

const (
	user    = "did:privy:alice"
	profile = "0b7c6a52-5a5c-4f4e-9a8e-1c2d3e4f5a6b"
)

var lowerHex = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

func newFake(t *testing.T) (*privytest.Fake, *Client) {
	f := privytest.New(t)
	return f, NewClient(privytest.AppID, privytest.AppSecret, f.URL)
}

func TestProfileWalletIsCreatedOnceAndFoundAgain(t *testing.T) {
	f, c := newFake(t)
	ctx := context.Background()
	first, err := c.ProfileWallet(ctx, user, profile)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != "wallet-1" || !lowerHex.MatchString(first.Address) {
		t.Fatalf("got %+v, want wallet-1 with a lowercase address", first)
	}
	if len(f.Creates) != 1 {
		t.Fatalf("%d creates, want 1", len(f.Creates))
	}
	body := f.Creates[0]
	owner, _ := body["owner"].(map[string]any)
	if body["chain_type"] != "ethereum" || body["external_id"] != profile || owner["user_id"] != user {
		t.Fatalf("create body %v: want an ethereum wallet owned by the user with external_id = profile id", body)
	}

	again, err := c.ProfileWallet(ctx, user, profile)
	if err != nil || again != first || len(f.Creates) != 1 {
		t.Fatalf("second call: %+v, %v, %d creates; want the same wallet and no new create", again, err, len(f.Creates))
	}
}

func TestProfileWalletLosesTheCreateRace(t *testing.T) {
	f, c := newFake(t)
	ctx := context.Background()
	theirs, err := c.ProfileWallet(ctx, user, profile)
	if err != nil {
		t.Fatal(err)
	}
	f.Lock()
	f.HideOnce = true
	f.Unlock()
	ours, err := c.ProfileWallet(ctx, user, profile)
	if err != nil || ours != theirs || f.Wallets() != 1 {
		t.Fatalf("got %+v, %v with %d wallets; want the existing wallet", ours, err, f.Wallets())
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
	if f.Wallets() != 1 {
		t.Fatalf("%d wallets in Privy, want 1", f.Wallets())
	}
}

func TestProfileWalletReportsPrivyErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer srv.Close()
	c := NewClient(privytest.AppID, "wrong-secret", srv.URL)
	if _, err := c.ProfileWallet(context.Background(), user, profile); err == nil {
		t.Fatal("a Privy error was swallowed")
	}
}

func TestProfileWalletGivesUpOnAHangingPrivy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer srv.Close()
	defer func(old time.Duration) { Timeout = old }(Timeout)
	Timeout = 200 * time.Millisecond
	start := time.Now()
	if _, err := NewClient(privytest.AppID, privytest.AppSecret, srv.URL).ProfileWallet(context.Background(), user, profile); err == nil {
		t.Fatal("a hanging Privy gave no error")
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("gave up after %v, want about %v", d, Timeout)
	}
}

func TestProfileWalletRecoversFromAFailedCreate(t *testing.T) {
	f, c := newFake(t)
	ctx := context.Background()
	f.Lock()
	f.FailCreates = 3 // the first call and the SDK's two retries
	f.Unlock()
	if _, err := c.ProfileWallet(ctx, user, profile); err == nil {
		t.Fatal("a failed create was not reported")
	}
	w, err := c.ProfileWallet(ctx, user, profile)
	if err != nil || w.ID != "wallet-1" {
		t.Fatalf("next call: %+v, %v; want the wallet created", w, err)
	}
}

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
