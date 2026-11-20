package profile

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
)

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

func TestProfilesPerUserAreCapped(t *testing.T) {
	s, f, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := range 2 * MaxProfiles {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, _ = s.Create(ctx, alice, fmt.Sprintf("key-%d", i), Merchant, "")
		}()
	}
	wg.Wait()
	if n := count(t, pool, "profiles"); n != MaxProfiles || f.Wallets() != MaxProfiles {
		t.Fatalf("%d profiles and %d wallets, want %d each", n, f.Wallets(), MaxProfiles)
	}
	if _, _, err := s.Create(ctx, alice, "one-more", Merchant, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("over the cap: %v, want ErrInvalid", err)
	}
	if _, created, err := s.Create(ctx, alice, "key-0", Merchant, ""); err != nil && !errors.Is(err, ErrInvalid) || created {
		t.Fatalf("a key used before the cap: created %v, %v", created, err)
	}
}
