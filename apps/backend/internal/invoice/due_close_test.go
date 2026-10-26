package invoice

import (
	"context"
	"testing"
	"time"
)

// R-152, D-80: a due date with no expiresIn keeps the checkout open to the end of its 60th UTC day after.
func TestDueDateKeepsTheCheckoutOpen(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	now := time.Date(2026, 10, 26, 15, 4, 5, 0, time.UTC)
	s.now = func() time.Time { return now }
	create := func(key, due string, expiresIn *int64) Invoice {
		t.Helper()
		inv, _, err := s.Create(ctx, profile, key, Request{ChainID: 84532, Token: usdc, Amount: "5000000",
			ExpiresInSeconds: expiresIn, Details: Details{DueDate: due}})
		if err != nil {
			t.Fatal(err)
		}
		return inv
	}
	day := func(s string) time.Time { d, _ := time.Parse(time.DateOnly, s); return d }

	due := create("key-due", "2026-11-30", nil)
	if want := day("2027-01-30"); !due.ExpiresAt.Equal(want) || !due.ClosesAt.Equal(want) {
		t.Errorf("due 2026-11-30: closes %v, expires %v; want the end of 2027-01-29, %v", due.ClosesAt, due.ExpiresAt, want)
	}
	// The hash took the request as sent: a minute later the same request is the same invoice.
	s.now = func() time.Time { return now.Add(time.Minute) }
	again, created, err := s.Create(ctx, profile, "key-due", Request{ChainID: 84532, Token: usdc, Amount: "5000000",
		Details: Details{DueDate: "2026-11-30"}})
	if err != nil || created || again.ID != due.ID || !again.ExpiresAt.Equal(due.ExpiresAt) {
		t.Errorf("a retry a minute later: %v, created %v, %s %v", err, created, again.ID, again.ExpiresAt)
	}
	s.now = func() time.Time { return now }

	// Within D-18's limits from now: a past due date closes in 15 minutes, a far one in 365 days.
	if past := create("key-past", "2026-01-01", nil); !past.ExpiresAt.Equal(now.Add(MinExpiresIn)) {
		t.Errorf("a past due date: expires %v, want %v", past.ExpiresAt, now.Add(MinExpiresIn))
	}
	if far := create("key-far", "2027-10-01", nil); !far.ExpiresAt.Equal(now.Add(MaxExpiresIn)) {
		t.Errorf("a far due date: expires %v, want %v", far.ExpiresAt, now.Add(MaxExpiresIn))
	}
	// With expiresIn the invoice uses it, due date or not.
	week := int64(7 * 24 * 3600)
	if sent := create("key-sent", "2026-11-30", &week); !sent.ExpiresAt.Equal(now.Add(7 * 24 * time.Hour)) {
		t.Errorf("expiresIn with a due date: expires %v", sent.ExpiresAt)
	}
	if plain := create("key-plain", "", nil); !plain.ExpiresAt.Equal(now.Add(DefaultExpiresIn)) {
		t.Errorf("no due date: expires %v", plain.ExpiresAt)
	}
}
