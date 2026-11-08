package invoice

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRetainerStartedFromReviseMakesLaterMonths(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	now, _ := time.Parse(time.DateOnly, "2027-01-10")
	s.now = func() time.Time { return now }
	original, _, err := s.Create(ctx, profile, "original", Request{AmountUSD: "5"})
	if err != nil {
		t.Fatal(err)
	}
	first, _, err := s.Create(ctx, profile, "revised", Request{AmountUSD: "6", Replaces: original.ID,
		Repeat: &Repeat{}, Details: Details{DueDate: "2027-01-31", ClientEmail: "ap@bob.example"}})
	if err != nil {
		t.Fatal(err)
	}
	// A stored template can contain the first invoice's one-time Revise action.
	if _, err := pool.Exec(ctx, `UPDATE retainers SET request = request || jsonb_build_object('Replaces', $1::text)`,
		original.ID); err != nil {
		t.Fatal(err)
	}
	for _, day := range []string{"2027-02-21", "2027-03-24"} {
		now, _ = time.Parse(time.DateOnly, day)
		for range 2 {
			if err := s.MakeRetainerInvoices(ctx); err != nil {
				t.Fatal(err)
			}
		}
	}
	var months, sends, replacements int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM retainer_invoices),
		(SELECT count(*) FROM outbox_events WHERE kind = 'invoice.sent'),
		(SELECT count(*) FROM history_events WHERE kind = 'invoice.replaced')`).Scan(&months, &sends, &replacements); err != nil {
		t.Fatal(err)
	}
	if months != 3 || sends != 2 || replacements != 1 {
		t.Fatalf("months %d, sends %d, replacements %d; want 3, 2, 1", months, sends, replacements)
	}
	old, err := s.GetOfProfile(ctx, profile, original.ID)
	if err != nil || old.ReplacedBy == nil || old.ReplacedBy.ID != first.ID {
		t.Fatalf("original replacement: %+v (%v), want %s", old.ReplacedBy, err, first.ID)
	}
}

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

// R-134: a later month copies the first invoice's return link, as Edit keeps a link its store no longer allows.
func TestRetainerMonthKeepsAReturnLinkItsStoreDropped(t *testing.T) {
	ctx := context.Background()
	pool, _ := open(t)
	s := NewService(pool)
	var shop string
	if err := pool.QueryRow(ctx, `
		WITH p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM users RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w2', 'evm', '0x2222222222222222222222222222222222222222' FROM p),
		     b AS (INSERT INTO profile_billing_details (profile_id, name, address, country, contact_email)
		           SELECT id, 'Shop', 'Main St 1', 'DE', 'shop@example.com' FROM p)
		SELECT id::text FROM p`).Scan(&shop); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE stores SET allowed_origins = '{https://shop.example}' WHERE profile_id = $1",
		shop); err != nil {
		t.Fatal(err)
	}
	at := func(day string) {
		now, _ := time.Parse(time.DateOnly, day)
		s.now = func() time.Time { return now.Add(12 * time.Hour) }
	}
	at("2027-01-10")
	if _, _, err := s.Create(ctx, shop, "k1", Request{ChainID: 84532, Token: usdc, Amount: "5000000",
		ExpiresInSeconds: new(int64(86400)), Repeat: &Repeat{},
		Details: Details{DueDate: "2027-01-31", ClientEmail: "ap@bob.example", ReturnURL: "https://shop.example/thanks"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE stores SET allowed_origins = '{}' WHERE profile_id = $1", shop); err != nil {
		t.Fatal(err)
	}
	at("2027-02-21")
	if err := s.MakeRetainerInvoices(ctx); err != nil {
		t.Fatal(err)
	}
	var links []string
	rows, err := pool.Query(ctx, `SELECT i.return_url FROM retainer_invoices ri JOIN invoices i ON i.id = ri.invoice_id
		ORDER BY ri.cycle`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var link string
		if err := rows.Scan(&link); err != nil {
			t.Fatal(err)
		}
		links = append(links, link)
	}
	if len(links) != 2 || links[1] != "https://shop.example/thanks" {
		t.Fatalf("return links by month: %v, want the first one's twice", links)
	}
}

// R-136: the client agreed to the token, so turning it off later stops no month.
func TestFixedRetainerMonthKeepsATokenTurnedOff(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	at := func(day string) {
		now, _ := time.Parse(time.DateOnly, day)
		s.now = func() time.Time { return now.Add(12 * time.Hour) }
	}
	at("2027-01-10")
	if _, _, err := s.Create(ctx, profile, "k1", Request{ChainID: 84532, Token: usdc, Amount: "5000000",
		ExpiresInSeconds: new(int64(86400)), Repeat: &Repeat{},
		Details: Details{DueDate: "2027-01-31", ClientEmail: "ap@bob.example"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO profile_tokens_off (profile_id, chain_id, token_contract)
		VALUES ($1, 84532, $2)`, profile, usdc); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Create(ctx, profile, "k2", Request{ChainID: 84532, Token: usdc, Amount: "1"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a new invoice on the token turned off: %v, want ErrInvalid", err)
	}
	at("2027-02-21")
	if err := s.MakeRetainerInvoices(ctx); err != nil {
		t.Fatal(err)
	}
	var months int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM retainer_invoices").Scan(&months); err != nil || months != 2 {
		t.Fatalf("%d months made (%v), want the first and February", months, err)
	}
}

// R-136: a payer-chooses month offers what is on when it is made, so with its only token off it is not made.
func TestPayerChoosesRetainerMonthOffersWhatIsOn(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	at := func(day string) {
		now, _ := time.Parse(time.DateOnly, day)
		s.now = func() time.Time { return now.Add(12 * time.Hour) }
	}
	at("2027-01-10")
	if _, _, err := s.Create(ctx, profile, "k1", Request{AmountUSD: "5", ExpiresInSeconds: new(int64(86400)),
		Repeat: &Repeat{}, Details: Details{DueDate: "2027-01-31", ClientEmail: "ap@bob.example"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO profile_tokens_off (profile_id, chain_id, token_contract)
		VALUES ($1, 84532, $2)`, profile, usdc); err != nil {
		t.Fatal(err)
	}
	at("2027-02-21")
	if err := s.MakeRetainerInvoices(ctx); !errors.Is(err, ErrInvalid) {
		t.Fatalf("the month with every token off: %v, want ErrInvalid", err)
	}
	var months int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM retainer_invoices").Scan(&months); err != nil || months != 1 {
		t.Fatalf("%d months made (%v), want only the first", months, err)
	}
}

// D-122: a retainer's months keep who pays its first month's fees, also one saved before the choice was in its
// request, when the profile chooses otherwise later.
func TestRetainerMonthsKeepWhoPaysTheFees(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	now, _ := time.Parse(time.DateOnly, "2027-01-10")
	s.now = func() time.Time { return now.Add(12 * time.Hour) }
	if _, _, err := s.Create(ctx, profile, "k1", Request{ChainID: 84532, Token: usdc, Amount: "5000000",
		ExpiresInSeconds: new(int64(86400)), Repeat: &Repeat{EndDate: "2027-04-30"},
		Details: Details{Title: "Retainer", DueDate: "2027-01-31", ClientName: "Bob Ltd", ClientEmail: "ap@bob.example"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE retainers SET request = request - 'FeesPaidBy'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE profiles SET fees_paid_by = 'client' WHERE id = $1`, profile); err != nil {
		t.Fatal(err)
	}
	now, _ = time.Parse(time.DateOnly, "2027-02-24")
	if err := s.MakeRetainerInvoices(ctx); err != nil {
		t.Fatal(err)
	}
	var paidBy string
	if err := pool.QueryRow(ctx, `SELECT string_agg(i.fees_paid_by, ',' ORDER BY ri.cycle) FROM retainer_invoices ri
		JOIN invoices i ON i.id = ri.invoice_id`).Scan(&paidBy); err != nil || paidBy != "owner,owner" {
		t.Fatalf("who pays each month: %q (%v), want the first month's owner twice", paidBy, err)
	}
}
