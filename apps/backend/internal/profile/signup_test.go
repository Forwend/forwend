package profile

import (
	"context"
	"sync"
	"testing"
	"time"
)

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
