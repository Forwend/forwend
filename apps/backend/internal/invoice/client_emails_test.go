package invoice

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
)

// R-116. Send to client past the cap waits too.
func TestRemindersFitTheUsersClientEmails(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	due := time.Now().UTC().AddDate(0, 0, -10).Format(time.DateOnly)
	var last Invoice
	for i := range outbox.MaxClientEmails + 5 {
		var err error
		last, _, err = s.Create(ctx, profile, fmt.Sprint("k", i), Request{ChainID: 84532, Token: usdc, Amount: "5000000",
			Reminders: true, Details: Details{DueDate: due, ClientEmail: fmt.Sprintf("c%d@client.example", i)}})
		if err != nil {
			t.Fatal(err)
		}
	}
	reminders := func() (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE kind = $1", outbox.Reminder).
			Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if err := s.QueueReminders(ctx); err != nil || reminders() != outbox.MaxClientEmails {
		t.Fatalf("queued %d (%v), want the cap %d", reminders(), err, outbox.MaxClientEmails)
	}
	var soon *TooSoonError
	if _, _, err := s.Send(ctx, profile, last.ID, "send-1", func() time.Duration { return 0 }); !errors.As(err, &soon) {
		t.Fatalf("Send to client at the cap: %v, want TooSoonError", err)
	}
	// A day later there is room for the rest.
	if _, err := pool.Exec(ctx, "UPDATE outbox_events SET created_at = now() - interval '25 hours'"); err != nil {
		t.Fatal(err)
	}
	if err := s.QueueReminders(ctx); err != nil || reminders() != outbox.MaxClientEmails+5 {
		t.Fatalf("queued %d (%v) a day later, want all %d", reminders(), err, outbox.MaxClientEmails+5)
	}
}

// R-116: the month is still made.
func TestRetainerMonthPastTheCapSendsNoEmail(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	at := func(day string) {
		now, _ := time.Parse(time.DateOnly, day)
		s.now = func() time.Time { return now.Add(12 * time.Hour) }
	}
	at("2027-01-10")
	first, _, err := s.Create(ctx, profile, "k1", Request{ChainID: 84532, Token: usdc, Amount: "5000000",
		ExpiresInSeconds: new(int64(86400)), Repeat: &Repeat{EndDate: "2027-04-30"},
		Details: Details{DueDate: "2027-01-31", ClientEmail: "ap@bob.example"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO outbox_events (kind, invoice_id, payload, idempotency_key)
		SELECT $1, $2, '{}', 'old-' || n FROM generate_series(1, $3) n`, outbox.Sent, first.ID,
		outbox.MaxClientEmails); err != nil {
		t.Fatal(err)
	}
	at("2027-02-21")
	if err := s.MakeRetainerInvoices(ctx); err != nil {
		t.Fatal(err)
	}
	var months, sends int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM retainer_invoices),
		(SELECT count(*) FROM outbox_events WHERE kind = $1)`, outbox.Sent).Scan(&months, &sends); err != nil ||
		months != 2 || sends != outbox.MaxClientEmails {
		t.Fatalf("months %d, sends %d (%v); want January and February made and no new email", months, sends, err)
	}
}
