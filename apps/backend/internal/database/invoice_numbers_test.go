package database

import (
	"context"
	"database/sql"
	"io/fs"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/pressly/goose/v3"
)

// Migration 8 numbers existing invoices per profile by creation time, then id; each counter continues after them.
func TestInvoiceNumbersForExistingInvoices(t *testing.T) {
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
	if _, err := provider.UpTo(ctx, 7); err != nil {
		t.Fatal(err)
	}
	var a, b string
	if err := conn.QueryRowContext(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name) VALUES (84532, 'evm', 'base-sepolia')),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
		            VALUES (84532, 'evm', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 'USDC', 6)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:1') RETURNING id),
		     a AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id),
		     b AS (INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM u RETURNING id)
		SELECT (SELECT id::text FROM a), (SELECT id::text FROM b)`).Scan(&a, &b); err != nil {
		t.Fatal(err)
	}
	insert := func(n int, profile, at string) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, `
			INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
			    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
			    request_hash, created_at)
			VALUES ('0x' || lpad(to_hex($1::int), 64, '0'), $2, 84532, 'evm',
			    '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 1, 1800000000, 1800086400, '0x' || repeat('11', 20),
			    'evm_create2', '0x' || repeat('22', 20),
			    '0x' || lpad(to_hex($1::int), 40, '0'), $1::text, decode(repeat('00', 32), 'hex'), $3)`,
			n, profile, at); err != nil {
			t.Fatal(err)
		}
	}
	insert(1, a, "2026-10-01T10:00:00Z")
	insert(3, a, "2026-10-01T09:00:00Z")
	insert(2, a, "2026-10-01T09:00:00Z") // same time as 3: the lower id comes first
	insert(4, b, "2026-10-01T08:00:00Z")
	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}
	insert(5, a, "2026-10-01T11:00:00Z")

	for n, want := range map[int]int64{2: 1, 3: 2, 1: 3, 5: 4, 4: 1} {
		var got int64
		if err := conn.QueryRowContext(ctx,
			"SELECT number FROM invoices WHERE id = '0x' || lpad(to_hex($1::int), 64, '0')", n).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("invoice %d has number %d, want %d", n, got, want)
		}
	}
}
