package profile

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
	"github.com/ensp1re/forwend/apps/backend/internal/privy/privytest"
	"github.com/jackc/pgx/v5/pgxpool"
)

const alice = "did:privy:alice"

func newService(t *testing.T) (*Service, *privytest.Fake, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	f := privytest.New(t)
	return NewService(pool, privy.NewClient(privytest.AppID, privytest.AppSecret, f.URL)), f, pool
}

func count(t *testing.T, pool *pgxpool.Pool, table string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSignUpOnce(t *testing.T) {
	s, f, pool := newService(t)
	ctx := context.Background()
	first, created, err := s.SignUp(ctx, alice)
	if err != nil || !created || len(first) != 1 || first[0].Kind != Personal || first[0].WalletAddress == "" {
		t.Fatalf("got %+v, %v, %v; want one new personal profile with a wallet", first, created, err)
	}
	again, created, err := s.SignUp(ctx, alice)
	if err != nil || created || len(again) != 1 || again[0] != first[0] {
		t.Fatalf("again: %+v, %v, %v; want the same profile, not created", again, created, err)
	}
	if count(t, pool, "users") != 1 || count(t, pool, "profiles") != 1 || f.Wallets() != 1 || len(f.Creates) != 1 {
		t.Fatalf("users %d, profiles %d, Privy wallets %d, creates %d; want 1 each", count(t, pool, "users"),
			count(t, pool, "profiles"), f.Wallets(), len(f.Creates))
	}
}

func TestSignUpConcurrently(t *testing.T) {
	s, f, pool := newService(t)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := s.SignUp(context.Background(), alice); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if count(t, pool, "users") != 1 || count(t, pool, "profiles") != 1 || count(t, pool, "profile_wallets") != 1 ||
		f.Wallets() != 1 {
		t.Fatal("concurrent signups made more than one user, profile or wallet")
	}
}

// Privy fails: the profile exists without a wallet, and the next signup makes the wallet.
func TestSignUpRetriesAFailedWallet(t *testing.T) {
	s, f, _ := newService(t)
	ctx := context.Background()
	f.Lock()
	f.FailCreates = 3 // the first call and the SDK's two retries
	f.Unlock()
	if _, _, err := s.SignUp(ctx, alice); err == nil {
		t.Fatal("a Privy failure was not reported")
	}
	if got, err := s.List(ctx, alice); err != nil || len(got) != 1 || got[0].WalletAddress != "" {
		t.Fatalf("after the failure: %+v, %v; want the personal profile without a wallet", got, err)
	}
	got, _, err := s.SignUp(ctx, alice)
	if err != nil || got[0].WalletAddress == "" {
		t.Fatalf("retry: %+v, %v; want the wallet", got, err)
	}
}

func TestCreateProfile(t *testing.T) {
	s, f, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	p, created, err := s.Create(ctx, alice, "key-1", Merchant, "Shop")
	if err != nil || !created || p.Kind != Merchant || p.Name != "Shop" || p.WalletAddress == "" {
		t.Fatalf("got %+v, %v, %v", p, created, err)
	}
	again, created, err := s.Create(ctx, alice, "key-1", Merchant, "Shop")
	if err != nil || created || again != p {
		t.Fatalf("same key again: %+v, %v, %v; want the stored profile", again, created, err)
	}
	if _, _, err := s.Create(ctx, alice, "key-1", Freelancer, "Shop"); !errors.Is(err, ErrConflict) {
		t.Fatalf("same key, other kind: %v, want ErrConflict", err)
	}
	other, _, err := s.Create(ctx, alice, "key-2", Freelancer, "")
	if err != nil || other.Name != "" || other.WalletAddress == p.WalletAddress {
		t.Fatalf("second profile %+v, %v; want no name and its own wallet", other, err)
	}
	if list, _ := s.List(ctx, alice); len(list) != 3 || count(t, pool, "profile_wallets") != 3 || f.Wallets() != 3 {
		t.Fatalf("%d profiles, want personal, merchant and freelancer, each with a wallet", len(list))
	}
}

func TestCreateProfileErrors(t *testing.T) {
	s, _, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.Create(ctx, alice, "key-1", Merchant, ""); !errors.Is(err, ErrNotSignedUp) {
		t.Fatalf("before signup: %v, want ErrNotSignedUp", err)
	}
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ kind, name string }{
		{Personal, ""}, {"developer", ""}, {Merchant, strings.Repeat("é", MaxNameLength+1)}, {Merchant, "\xff"}, {Merchant, "a\x00b"},
	} {
		if _, _, err := s.Create(ctx, alice, "key-1", c.kind, c.name); !errors.Is(err, ErrInvalid) {
			t.Fatalf("kind %q name %q: %v, want ErrInvalid", c.kind, c.name, err)
		}
	}
	if _, _, err := s.Create(ctx, alice, "key-1", Merchant, strings.Repeat("é", MaxNameLength)); err != nil {
		t.Fatalf("a %d-character name: %v", MaxNameLength, err)
	}
	if count(t, pool, "profiles") != 2 {
		t.Fatal("a refused request stored a profile")
	}
}

func TestCreateProfileSameKeyConcurrently(t *testing.T) {
	s, f, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	ids := make([]string, 8)
	for i := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, _, err := s.Create(ctx, alice, "key-1", Freelancer, "")
			if err != nil {
				t.Error(err)
			}
			ids[i] = p.ID
		}()
	}
	wg.Wait()
	for _, id := range ids {
		if id != ids[0] {
			t.Fatalf("one key made two profiles: %v", ids)
		}
	}
	if count(t, pool, "profiles") != 2 || f.Wallets() != 2 {
		t.Fatal("one key made more than one profile or wallet")
	}
}

// Keys are per user: another user's key never returns or blocks this user's profile.
func TestKeysArePerUser(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	for _, u := range []string{alice, "did:privy:bob"} {
		if _, _, err := s.SignUp(ctx, u); err != nil {
			t.Fatal(err)
		}
	}
	a, _, err := s.Create(ctx, alice, "key-1", Merchant, "")
	if err != nil {
		t.Fatal(err)
	}
	b, created, err := s.Create(ctx, "did:privy:bob", "key-1", Freelancer, "")
	if err != nil || !created || b.ID == a.ID {
		t.Fatalf("Bob with Alice's key: %+v, %v, %v; want his own new profile", b, created, err)
	}
	if list, _ := s.List(ctx, "did:privy:bob"); len(list) != 2 {
		t.Fatalf("Bob sees %d profiles, want his 2", len(list))
	}
}

// A wallet Privy returns that is already stored for another profile is an error, never a profile left without one.
func TestSignUpRefusesAWalletStoredElsewhere(t *testing.T) {
	s, _, pool := newService(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		WITH u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:bob') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM u RETURNING id)
		INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		SELECT id, 'privy', 'wallet-1', 'evm', '0x1111111111111111111111111111111111111111' FROM p`); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SignUp(ctx, alice); err == nil {
		t.Fatal("a wallet stored for another profile was accepted")
	}
}

// A profile whose wallet Privy failed to make is still created and returned, without a wallet, so a retry with other
// values can't make a second one; the next signup call makes its wallet.
func TestCreateWithoutWalletThenSignUpRepairsIt(t *testing.T) {
	s, f, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	f.FailCreates = 3 // the first call and the SDK's two retries
	f.Unlock()
	p, created, err := s.Create(ctx, alice, "key-1", Merchant, "Shop")
	if err != nil || !created || p.Kind != Merchant || p.WalletAddress != "" {
		t.Fatalf("create while Privy fails: %+v, %v, %v; want the stored profile without a wallet", p, created, err)
	}
	got, _, err := s.SignUp(ctx, alice)
	if err != nil || len(got) != 2 || got[1].ID != p.ID || got[1].WalletAddress == "" {
		t.Fatalf("after signup: %+v, %v; want the merchant profile with its wallet", got, err)
	}
	if count(t, pool, "profiles") != 2 {
		t.Fatal("more than one merchant profile")
	}
}

// A slow Privy never holds signup past RepairBudget for profiles other than the personal one.
func TestSignUpRepairIsBounded(t *testing.T) {
	s, f, _ := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	f.FailCreates = 6
	f.Unlock()
	for _, key := range []string{"key-1", "key-2"} {
		if _, _, err := s.Create(ctx, alice, key, Merchant, key); err != nil {
			t.Fatal(err)
		}
	}
	defer func(old time.Duration) { RepairBudget = old }(RepairBudget)
	RepairBudget = 300 * time.Millisecond
	f.Lock()
	f.Delay = 5 * time.Second
	f.Unlock()
	start := time.Now()
	got, _, err := s.SignUp(ctx, alice)
	if err != nil || len(got) != 3 {
		t.Fatalf("signup with a slow Privy: %+v, %v; want the three profiles", got, err)
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("signup took %v; want about RepairBudget (%v)", d, RepairBudget)
	}
}
