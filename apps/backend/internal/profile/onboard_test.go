package profile

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
)

// kinds lists the profiles' kinds sorted: profiles made in one transaction share created_at, so their order is open.
func kinds(profiles []Profile) []string {
	var out []string
	for _, p := range profiles {
		out = append(out, p.Kind)
	}
	slices.Sort(out)
	return out
}

// The choices make their profiles once, each with a wallet; a second call, with any choices, makes none.
func TestOnboardOnce(t *testing.T) {
	s, f, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	if at, err := s.OnboardedAt(ctx, alice); err != nil || at != nil {
		t.Fatalf("before onboarding: %v, %v; want nil", at, err)
	}
	first, at, onboarded, err := s.Onboard(ctx, alice,
		[]string{ReceiveAndSend, GetPaidByClients, AcceptBusinessPayments, BuildIntegration, GetPaidByClients})
	if err != nil || !onboarded || at.IsZero() {
		t.Fatalf("onboard: %v, %v, %v", at, onboarded, err)
	}
	if got := kinds(first); !slices.Equal(got, []string{Freelancer, Merchant, Personal}) {
		t.Fatalf("profiles %v; want personal, one freelancer and one merchant", got)
	}
	for _, p := range first {
		if p.WalletAddress == "" {
			t.Fatalf("%s profile has no wallet", p.Kind)
		}
	}
	again, againAt, onboarded, err := s.Onboard(ctx, alice, []string{AcceptBusinessPayments})
	if err != nil || onboarded || !againAt.Equal(at) || len(again) != 3 {
		t.Fatalf("again: %v profiles, %v, %v, %v; want the same state", kinds(again), againAt, onboarded, err)
	}
	if stored, _ := s.OnboardedAt(ctx, alice); stored == nil || !stored.Equal(at) {
		t.Fatalf("stored onboarded_at %v, want %v", stored, at)
	}
	if count(t, pool, "profiles") != 3 || f.Wallets() != 3 {
		t.Fatal("a repeated onboarding made a profile or wallet")
	}
}

func TestOnboardSkip(t *testing.T) {
	s, f, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	list, at, onboarded, err := s.Onboard(ctx, alice, []string{})
	if err != nil || !onboarded || at.IsZero() || len(list) != 1 {
		t.Fatalf("skip: %v, %v, %v, %v; want onboarded with only the personal profile", kinds(list), at, onboarded, err)
	}
	if _, _, onboarded, _ := s.Onboard(ctx, alice, []string{GetPaidByClients}); onboarded ||
		count(t, pool, "profiles") != 1 || f.Wallets() != 1 {
		t.Fatal("choosing after a skip made a profile")
	}
}

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
			_, _, onboarded, err := s.Onboard(ctx, alice, []string{GetPaidByClients, BuildIntegration})
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

func TestOnboardErrors(t *testing.T) {
	s, _, pool := newService(t)
	ctx := context.Background()
	if _, _, _, err := s.Onboard(ctx, alice, []string{}); !errors.Is(err, ErrNotSignedUp) {
		t.Fatalf("before signup: %v, want ErrNotSignedUp", err)
	}
	if _, err := s.OnboardedAt(ctx, alice); !errors.Is(err, ErrNotSignedUp) {
		t.Fatalf("OnboardedAt before signup: %v, want ErrNotSignedUp", err)
	}
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	for _, choices := range [][]string{nil, {"freelancer"}, {GetPaidByClients, ""}} {
		if _, _, _, err := s.Onboard(ctx, alice, choices); !errors.Is(err, ErrInvalid) {
			t.Fatalf("choices %q: %v, want ErrInvalid", choices, err)
		}
	}
	if at, _ := s.OnboardedAt(ctx, alice); at != nil || count(t, pool, "profiles") != 1 {
		t.Fatal("a refused request onboarded the user or made a profile")
	}
}
