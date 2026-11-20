package profile

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
)

func TestOnboardConcurrently(t *testing.T) {
	s, f, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	firsts := 0
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, onboarded, err := s.Onboard(ctx, alice, []string{GetPaidByClients, BuildIntegration}, nil)
			if err != nil {
				t.Error(err)
			}
			mu.Lock()
			defer mu.Unlock()
			if onboarded {
				firsts++
			}
		}()
	}
	wg.Wait()
	if firsts != 1 || count(t, pool, "profiles") != 3 || count(t, pool, "profile_wallets") != 3 || f.Wallets() != 3 {
		t.Fatalf("%d calls onboarded, %d profiles; want 1 call and personal, freelancer, merchant",
			firsts, count(t, pool, "profiles"))
	}
}

func TestOnboardKeepsTheProfileCap(t *testing.T) {
	s, _, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	for i := range MaxProfiles - 2 {
		if _, _, err := s.Create(ctx, alice, fmt.Sprintf("key-%d", i), Merchant, ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, _, err := s.Onboard(ctx, alice, []string{GetPaidByClients, AcceptBusinessPayments}, nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("onboarding past the cap: %v, want ErrInvalid", err)
	}
	if n := count(t, pool, "profiles"); n != MaxProfiles-1 {
		t.Fatalf("%d profiles, want %d", n, MaxProfiles-1)
	}
}

func TestOnboardAtTheCapWithoutNewProfilesIsAllowed(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	for i := range MaxProfiles - 1 {
		if _, _, err := s.Create(ctx, alice, fmt.Sprintf("key-%d", i), Merchant, ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, _, err := s.Onboard(ctx, alice, []string{ReceiveAndSend}, nil); err != nil {
		t.Fatalf("onboarding that adds no profile at the cap: %v", err)
	}
}

func TestOnboardNamesTheProfilesItMakes(t *testing.T) {
	s, _, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	names := map[string]string{Freelancer: "Mara Ilić Design", Merchant: "North & Co."}
	list, _, _, err := s.Onboard(ctx, alice, []string{GetPaidByClients, AcceptBusinessPayments}, names)
	if err != nil {
		t.Fatal(err)
	}
	var merchantID string
	for _, p := range list {
		if want := names[p.Kind]; p.Name != want {
			t.Fatalf("%s profile named %q, want %q", p.Kind, p.Name, want)
		}
		if p.Kind == Merchant {
			merchantID = p.ID
		}
	}
	var store string
	if err := pool.QueryRow(ctx, "SELECT name FROM stores WHERE profile_id = $1", merchantID).Scan(&store); err != nil {
		t.Fatal(err)
	}
	if store != "North & Co." {
		t.Fatalf("first store named %q, want the business name", store)
	}
	again, _, _, err := s.Onboard(ctx, alice, []string{GetPaidByClients}, map[string]string{Freelancer: "Other"})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range again {
		if p.Kind == Freelancer && p.Name != "Mara Ilić Design" {
			t.Fatalf("a second call renamed the freelancer profile to %q", p.Name)
		}
	}
}

func TestOnboardRefusesNamesItCannotUse(t *testing.T) {
	s, _, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	for _, names := range []map[string]string{
		{Personal: "Me"},
		{Freelancer: "Forwend"},
		{Freelancer: "Mara‮"}, // ends in U+202E
	} {
		if _, _, _, err := s.Onboard(ctx, alice, []string{GetPaidByClients}, names); !errors.Is(err, ErrInvalid) {
			t.Fatalf("names %q: %v, want ErrInvalid", names, err)
		}
	}
	if at, _ := s.OnboardedAt(ctx, alice); at != nil || count(t, pool, "profiles") != 1 {
		t.Fatal("a refused request onboarded the user or made a profile")
	}
}
