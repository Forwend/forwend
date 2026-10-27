package database

import (
	"context"
	"database/sql"
	"io/fs"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/pressly/goose/v3"
)

func TestMigrationsRollBackAndReapply(t *testing.T) {
	ctx := context.Background()
	conn, err := sql.Open("pgx", databasetest.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, conn, files)
	if err != nil {
		t.Fatal(err)
	}
	for _, step := range []func(context.Context) error{
		func(ctx context.Context) error { _, err := provider.Up(ctx); return err },
		func(ctx context.Context) error { _, err := provider.DownTo(ctx, 0); return err },
		func(ctx context.Context) error { _, err := provider.Up(ctx); return err },
	} {
		if err := step(ctx); err != nil {
			t.Fatal(err)
		}
	}
}

// R-130: 55 gives a reopened row written before it the exact close and takes it back; 54 never rolls back past a
// reopen, which moved held money to the creator.
func TestMigrationsKeepAReopenedInvoice(t *testing.T) {
	ctx := context.Background()
	conn, err := sql.Open("pgx", databasetest.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, conn, files)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 54); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{`
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name) VALUES (84532, 'evm', 'base-sepolia') ON CONFLICT (chain_id) DO NOTHING),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
		            VALUES (84532, 'evm', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 'USDC', 6)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:1') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id)
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		    request_hash)
		SELECT '0x' || repeat('01', 32), id, 84532, 'evm', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 5, 1800000000,
		    1800086400, '0x' || repeat('11', 20), 'evm_create2', '0x' || repeat('22', 20), '0x' || repeat('33', 20),
		    'key-1', decode(repeat('00', 32), 'hex') FROM p`,
		"UPDATE invoices SET payment_status = 'expired_partially_paid'",
		"UPDATE invoices SET payment_status = 'partially_paid', reopened_until = 1800003600",
		`INSERT INTO history_events (invoice_id, kind, actor, data)
		SELECT id, 'invoice.reopened', 'owner', '{"to": "2027-01-15"}' FROM invoices`,
	} {
		if _, err := conn.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	data := func(want string) {
		t.Helper()
		var got string
		if err := conn.QueryRowContext(ctx, "SELECT data::text FROM history_events").Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("history data %s, want %s", got, want)
		}
	}

	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}
	data(`{"until": "2027-01-15T09:00:00Z"}`)
	if _, err := provider.DownTo(ctx, 53); err == nil || !strings.Contains(err.Error(), "1 reopened invoice(s)") {
		t.Fatalf("rolling back past the reopen: %v, want a refusal naming 1 reopened invoice", err)
	}
	if version, err := provider.GetDBVersion(ctx); err != nil || version != 54 {
		t.Fatalf("after the refusal: version %d, %v; want 54 kept", version, err)
	}
	data(`{"to": "2027-01-15"}`)
}

// R-141: 65 never rolls back while a link invoice has no number, which the old schema can't hold.
func TestMigrationsKeepAnUnnumberedLinkInvoice(t *testing.T) {
	ctx := context.Background()
	conn, err := sql.Open("pgx", databasetest.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, conn, files)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 65); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.ExecContext(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name) VALUES (84532, 'evm', 'base-sepolia') ON CONFLICT (chain_id) DO NOTHING),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
		            VALUES (84532, 'evm', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 'USDC', 6)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:1') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id),
		     l AS (INSERT INTO payment_links (id, profile_id, slug, title)
		           SELECT 'aaaaaaaa-0000-4000-8000-000000000001', id, 'k3f9q2m7x1ab', 'Hourly' FROM p RETURNING id, profile_id)
		INSERT INTO invoices (id, profile_id, link_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		    request_hash)
		SELECT '0x' || repeat('01', 32), profile_id, id, 84532, 'evm', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 5,
		    1800000000, 1800086400, '0x' || repeat('11', 20), 'evm_create2', '0x' || repeat('22', 20),
		    '0x' || repeat('33', 20), 'key-1', decode(repeat('00', 32), 'hex') FROM l`); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.DownTo(ctx, 64); err == nil || !strings.Contains(err.Error(), "1 payment-link invoice row(s)") {
		t.Fatalf("rolling back with an unnumbered link invoice: %v, want a refusal naming 1 row", err)
	}
	if version, err := provider.GetDBVersion(ctx); err != nil || version != 65 {
		t.Fatalf("after the refusal: version %d, %v; want 65 kept", version, err)
	}
}
