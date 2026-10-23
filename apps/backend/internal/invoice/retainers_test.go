package invoice

import (
	"context"
	"errors"
	"testing"
	"time"
)

// R-98: each month's due day is the first due date's day, or the month's last day when shorter.
func TestRetainerMakesEachMonthOnce(t *testing.T) {
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
		Details: Details{Title: "Retainer", DueDate: "2027-01-31", ClientName: "Bob Ltd", ClientEmail: "ap@bob.example"}})
	if err != nil {
		t.Fatal(err)
	}
	type made struct {
		due, title, email string
		expires           time.Time
	}
	months := func() []made {
		t.Helper()
		if err := s.MakeRetainerInvoices(ctx); err != nil {
			t.Fatal(err)
		}
		rows, err := pool.Query(ctx, `SELECT to_char(i.due_date, 'YYYY-MM-DD'), i.title, i.client_email,
			to_timestamp(i.expires_at) FROM retainer_invoices ri JOIN invoices i ON i.id = ri.invoice_id ORDER BY ri.cycle`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []made
		for rows.Next() {
			var m made
			if err := rows.Scan(&m.due, &m.title, &m.email, &m.expires); err != nil {
				t.Fatal(err)
			}
			m.expires = m.expires.UTC()
			out = append(out, m)
		}
		return out
	}
	sends := func() (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE kind = 'invoice.sent'").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	day := func(s string) time.Time { d, _ := time.Parse(time.DateOnly, s); return d }

	if r, err := s.GetOfProfile(ctx, profile, first.ID); err != nil || r.Retainer == nil ||
		*r.Retainer != (Retainer{EndDate: "2027-04-30", NextDue: "2027-02-28", NextOn: "2027-02-21"}) {
		t.Fatalf("first invoice's retainer: %+v %v", r.Retainer, err)
	}
	at("2027-02-20")
	if got := months(); len(got) != 1 || sends() != 0 {
		t.Fatalf("8 days before: %d invoices, %d sends; want only the first", len(got), sends())
	}
	at("2027-02-21")
	for range 2 {
		got := months()
		want := made{due: "2027-02-28", title: "Retainer", email: "ap@bob.example", expires: day("2027-04-30")}
		if len(got) != 2 || got[1] != want || sends() != 1 {
			t.Fatalf("7 days before: %+v, %d sends; want %+v and one send", got, sends(), want)
		}
	}
	for _, d := range []string{"2027-03-24", "2027-04-23", "2027-05-24"} {
		at(d)
		months()
	}
	got := months()
	if len(got) != 4 || got[2].due != "2027-03-31" || got[3].due != "2027-04-30" || sends() != 3 {
		t.Fatalf("March, April and none past the end date: %+v, %d sends", got, sends())
	}
	if r, err := s.GetOfProfile(ctx, profile, first.ID); err != nil || r.Retainer.NextDue != "" || r.Retainer.NextOn != "" {
		t.Fatalf("ended retainer: %+v %v", r.Retainer, err)
	}
	var makers string
	if err := pool.QueryRow(ctx, `SELECT string_agg(h.actor, ',' ORDER BY ri.cycle) FROM retainer_invoices ri
		JOIN history_events h ON h.invoice_id = ri.invoice_id AND h.kind = 'invoice.created'`).Scan(&makers); err != nil ||
		makers != "owner,system,system,system" {
		t.Fatalf("made by %q (%v), want owner,system,system,system", makers, err)
	}
}

// R-98: also when the stop lands while the worker is making a month.
func TestStoppedRetainerMakesNothing(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	due := time.Now().UTC().AddDate(0, 0, -20).Format(time.DateOnly)
	first, _, err := s.Create(ctx, profile, "k1", Request{ChainID: 84532, Token: usdc, Amount: "5000000",
		Repeat: &Repeat{}, Details: Details{DueDate: due, ClientName: "Bob Ltd", ClientEmail: "ap@bob.example"}})
	if err != nil {
		t.Fatal(err)
	}
	var retainer string
	if err := pool.QueryRow(ctx, "SELECT retainer_id FROM retainer_invoices").Scan(&retainer); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		r, err := s.StopRetainer(ctx, profile, first.ID)
		if err != nil || r.Retainer.StoppedAt.IsZero() || r.Retainer.NextDue != "" {
			t.Fatalf("stop: %+v %v", r.Retainer, err)
		}
	}
	if err := s.MakeRetainerInvoices(ctx); err != nil {
		t.Fatal(err)
	}
	// The worker read the retainer as running just before the stop.
	_, _, err = s.Create(ctx, profile, "retainer:"+retainer+":1", Request{ChainID: 84532, Token: usdc, Amount: "5000000",
		Details: Details{DueDate: due}, cycle: &cycle{retainer: retainer, n: 1}})
	if !errors.Is(err, errRetainerStopped) {
		t.Fatalf("month after the stop: %v, want errRetainerStopped", err)
	}
	var invoices, sends int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM invoices),
		(SELECT count(*) FROM outbox_events WHERE kind = 'invoice.sent')`).Scan(&invoices, &sends); err != nil {
		t.Fatal(err)
	}
	if invoices != 1 || sends != 0 {
		t.Fatalf("%d invoices and %d sends after the stop, want the first invoice only", invoices, sends)
	}
}

// R-98, R-96.
func TestRetainerSkipsPassedMonthsAndKeepsAReminderStop(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	at := func(day string) {
		now, _ := time.Parse(time.DateOnly, day)
		s.now = func() time.Time { return now.Add(12 * time.Hour) }
	}
	at("2027-05-10")
	first, _, err := s.Create(ctx, profile, "k1", Request{ChainID: 84532, Token: usdc, Amount: "5000000",
		Reminders: true, Repeat: &Repeat{},
		Details: Details{DueDate: "2027-01-15", ClientName: "Bob Ltd", ClientEmail: "ap@bob.example"}})
	if err != nil {
		t.Fatal(err)
	}
	if r, err := s.GetOfProfile(ctx, profile, first.ID); err != nil || r.Retainer == nil ||
		r.Retainer.NextDue != "2027-05-15" || r.Retainer.NextOn != "2027-05-10" {
		t.Fatalf("a first due date months back: %+v %v, want May 15 made today", r.Retainer, err)
	}
	type month struct {
		due       string
		reminders bool
	}
	made := func() []month {
		t.Helper()
		for range 3 {
			if err := s.MakeRetainerInvoices(ctx); err != nil {
				t.Fatal(err)
			}
		}
		rows, err := pool.Query(ctx, `SELECT to_char(i.due_date, 'YYYY-MM-DD'), coalesce(ir.enabled, false)
			FROM retainer_invoices ri JOIN invoices i ON i.id = ri.invoice_id
			LEFT JOIN invoice_reminders ir ON ir.invoice_id = i.id ORDER BY ri.cycle`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []month
		for rows.Next() {
			var m month
			if err := rows.Scan(&m.due, &m.reminders); err != nil {
				t.Fatal(err)
			}
			out = append(out, m)
		}
		return out
	}
	var sends int
	if got := made(); len(got) != 2 || got[1] != (month{"2027-05-15", true}) {
		t.Fatalf("after 3 rounds: %+v, want only May 15 added, with reminders", got)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE kind = 'invoice.sent'").Scan(&sends); err != nil || sends != 1 {
		t.Fatalf("%d sends %v, want 1", sends, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE invoice_reminders SET stopped_at = now() WHERE invoice_id =
		(SELECT invoice_id FROM retainer_invoices WHERE cycle = 4)`); err != nil {
		t.Fatal(err)
	}
	at("2027-06-08")
	if got := made(); len(got) != 3 || got[2] != (month{"2027-06-15", false}) {
		t.Fatalf("after the client's stop: %+v, want June 15 without reminders", got)
	}
}
