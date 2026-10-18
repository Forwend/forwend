package job

import (
	"context"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5/pgxpool"
)

// open migrates a fresh database with Base Sepolia, enabled USDC and one freelancer profile with a wallet and billing
// details.
func open(t *testing.T) (*pgxpool.Pool, string) {
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
	var profile string
	err = pool.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true) RETURNING chain_id),
		     cur AS (INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) SELECT chain_id, 0, 0 FROM c),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w1', 'evm', '0x1111111111111111111111111111111111111111' FROM p),
		     b AS (INSERT INTO profile_billing_details (profile_id, name, address, country, contact_email)
		           SELECT id, 'Alice', 'Main St 1', 'DE', 'alice@example.com' FROM p)
		SELECT id::text FROM p`).Scan(&profile)
	if err != nil {
		t.Fatal(err)
	}
	return pool, profile
}

func quote(deposit bool) Request {
	return Request{Title: "Logo design", Client: profile.ClientDetails{Name: "Bob Ltd", Email: "ap@bob.example"},
		Payments: []PaymentRequest{{Title: "Deposit", AmountUSD: "300", DueDays: 7, OnAccept: deposit},
			{Title: "Final delivery", AmountUSD: "700.50", DueDays: 14}}}
}

// R-100: acceptance records the typed name, email and time once and makes the deposit invoice in the same
// transaction: payer chooses in USD, the job's title and client, one line, due 7 days after the UTC day, open 60 more.
func TestAcceptMakesTheDepositOnce(t *testing.T) {
	ctx := context.Background()
	pool, profileID := open(t)
	invoices := invoice.NewService(pool)
	s := NewService(pool, invoices)
	j, _, err := s.Create(ctx, profileID, "k1", quote(true))
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := s.Accept(ctx, j.Token, "Jane Doe", "jane@bob.example")
	if err != nil {
		t.Fatal(err)
	}
	if accepted.AcceptedName != "Jane Doe" || accepted.AcceptedEmail != "jane@bob.example" || accepted.AcceptedAt.IsZero() {
		t.Fatalf("acceptance %q %q %v", accepted.AcceptedName, accepted.AcceptedEmail, accepted.AcceptedAt)
	}
	deposit := accepted.Payments[0]
	if deposit.InvoiceID == "" || deposit.Status != "open" || accepted.Payments[1].InvoiceID != "" {
		t.Fatalf("payments %+v", accepted.Payments)
	}
	inv, err := invoices.GetOfProfile(ctx, profileID, deposit.InvoiceID)
	if err != nil {
		t.Fatal(err)
	}
	due := time.Now().UTC().AddDate(0, 0, 7).Format(time.DateOnly)
	if inv.Amount.String() != "300000000" || inv.Title != "Logo design" || inv.DueDate != due ||
		inv.ClientName != "Bob Ltd" || inv.ClientEmail != "ap@bob.example" || len(inv.Lines) != 1 ||
		inv.Lines[0].Description != "Deposit" || inv.Lines[0].Quantity != "1.00" {
		t.Fatalf("deposit invoice %+v %+v", inv.Details, inv.Lines)
	}
	if days := inv.ExpiresAt.Sub(time.Now()).Hours() / 24; days < 67.9 || days > 68.1 {
		t.Fatalf("checkout closes in %.2f days, want 7 + 61", days)
	}
	again, err := s.Accept(ctx, j.Token, "Someone Else", "else@example.com")
	if err != nil || again.AcceptedName != "Jane Doe" || again.Payments[0].InvoiceID != deposit.InvoiceID {
		t.Fatalf("second accept: %+v %v", again, err)
	}

	// Clients clicking at once make one deposit, and each gets the job back. The profile lock that Create takes holds
	// them all until each has passed its checks, so they race to insert the same key.
	j2, _, err := s.Create(ctx, profileID, "k2", quote(true))
	if err != nil {
		t.Fatal(err)
	}
	hold, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := hold.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE", profileID); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	got := make([]Job, 5)
	errs := make([]error, 5)
	for i := range 5 {
		wg.Go(func() { got[i], errs[i] = s.Accept(ctx, j2.Token, "Jane Doe", "jane@bob.example") })
	}
	for waiting := 0; waiting < 5; {
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'
			AND datname = current_database()`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
	}
	if err := hold.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	for i := range 5 {
		if errs[i] != nil || got[i].Payments[0].InvoiceID == "" || got[i].Payments[0].InvoiceID != got[0].Payments[0].InvoiceID {
			t.Fatalf("accept %d: %+v %v", i, got[i].Payments, errs[i])
		}
	}
	var made int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM invoices WHERE main_id IS NULL").Scan(&made); err != nil || made != 2 {
		t.Fatalf("%d invoices %v, want 2 deposits", made, err)
	}
}

// R-100: a job without a deposit makes no invoice at acceptance.
func TestAcceptWithoutDepositMakesNoInvoice(t *testing.T) {
	ctx := context.Background()
	pool, profileID := open(t)
	s := NewService(pool, invoice.NewService(pool))
	j, _, err := s.Create(ctx, profileID, "k1", quote(false))
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := s.Accept(ctx, j.Token, "Jane Doe", "jane@bob.example")
	if err != nil || accepted.AcceptedAt.IsZero() {
		t.Fatalf("accept: %v %v", accepted.AcceptedAt, err)
	}
	if ids := []string{accepted.Payments[0].InvoiceID, accepted.Payments[1].InvoiceID}; !reflect.DeepEqual(ids, []string{"", ""}) {
		t.Fatalf("invoices %v, want none", ids)
	}
}

// R-100: accepts on both sides of UTC midnight make different deposit requests under one key; the later one reads the
// job as accepted instead of failing.
func TestAcceptAcrossMidnight(t *testing.T) {
	ctx := context.Background()
	pool, profileID := open(t)
	invoices := invoice.NewService(pool)
	before, after := NewService(pool, invoices), NewService(pool, invoices)
	midnight := time.Now().UTC().Truncate(24 * time.Hour).Add(24 * time.Hour)
	before.now = func() time.Time { return midnight.Add(-time.Second) }
	after.now = func() time.Time { return midnight.Add(time.Second) }
	j, _, err := before.Create(ctx, profileID, "k1", quote(true))
	if err != nil {
		t.Fatal(err)
	}
	hold, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := hold.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE", profileID); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	got := make([]Job, 2)
	errs := make([]error, 2)
	for i, s := range []*Service{before, after} {
		wg.Go(func() { got[i], errs[i] = s.Accept(ctx, j.Token, "Jane Doe", "jane@bob.example") })
	}
	for waiting := 0; waiting < 2; {
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'
			AND datname = current_database()`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
	}
	if err := hold.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	for i := range 2 {
		if errs[i] != nil || got[i].Payments[0].InvoiceID == "" || got[i].Payments[0].InvoiceID != got[0].Payments[0].InvoiceID {
			t.Fatalf("accept %d: %+v %v", i, got[i].Payments, errs[i])
		}
	}
}
