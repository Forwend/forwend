package database

import (
	"context"
	"database/sql"
	"io/fs"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/pressly/goose/v3"
)

func TestPaymentPurposeMigrationPreservesLegacyDocuments(t *testing.T) {
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
	if _, err := provider.UpTo(ctx, 75); err != nil {
		t.Fatal(err)
	}
	exec := func(query string) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	exec(`WITH c AS (INSERT INTO chains (chain_id, chain_family, name) VALUES (1, 'evm', 'test')),
		 tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
		 VALUES (1, 'evm', '0x' || repeat('11', 20), 'USDC', 6)),
		 u AS (INSERT INTO users (privy_user_id) VALUES ('migration') RETURNING id)
		 INSERT INTO profiles (user_id, kind) SELECT id, unnest(ARRAY['personal', 'freelancer']) FROM u`)
	exec(`INSERT INTO payment_links (id, profile_id, slug, title)
		 SELECT 'cccccccc-0000-4000-8000-000000000001', id, 'abcdefghijkl', 'Offer' FROM profiles WHERE kind = 'freelancer'`)
	for n, kind := range []string{"freelancer", "personal", "freelancer"} {
		_, err := conn.ExecContext(ctx, `INSERT INTO invoices (id, profile_id, chain_id, chain_family,
		 token_contract, amount, expires_at, settle_deadline, recipient_address, receive_method, factory_address,
		 receive_address, idempotency_key, request_hash, link_id)
		 SELECT '0x' || lpad(to_hex($1::int), 64, '0'), id, 1, 'evm', '0x' || repeat('11', 20), 1,
		 1800000000, 1800086400, '0x' || repeat('22', 20), 'evm_create2', '0x' || repeat('33', 20),
		 '0x' || lpad(to_hex($1::int), 40, '0'), $1::text, decode(repeat('ab', 32), 'hex'),
		 CASE WHEN $1 = 3 THEN 'cccccccc-0000-4000-8000-000000000001'::uuid END FROM profiles WHERE kind = $2`, n+1, kind)
		if err != nil {
			t.Fatal(err)
		}
	}
	var before string
	if err := conn.QueryRowContext(ctx, `SELECT jsonb_agg(to_jsonb(i) ORDER BY id)::text FROM invoices i`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}
	for n, want := range []string{"invoice/invoice", "request/request", "checkout/invoice"} {
		var got string
		if err := conn.QueryRowContext(ctx, `SELECT purpose || '/' || document_kind FROM invoices
		 WHERE id = '0x' || lpad(to_hex($1::int), 64, '0')`, n+1).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("row %d: %s, want %s", n+1, got, want)
		}
	}
	var after string
	// picked_id and the fees came later (R-57, R-226); old rows have none.
	if err := conn.QueryRowContext(ctx, `SELECT jsonb_agg(to_jsonb(i) - 'purpose' - 'document_kind' - 'picked_id'
		- 'network_fee' - 'platform_fee' ORDER BY id)::text
		FROM invoices i WHERE picked_id IS NULL AND network_fee = 0 AND platform_fee = 0`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("migration changed existing terms, identifiers, numbers, snapshots or request hashes")
	}
	exec(`WITH n AS (UPDATE profiles p SET invoice_seq = invoice_seq + 1 FROM invoices m
		 WHERE m.id = '0x' || lpad('3', 64, '0') AND m.number IS NULL AND p.id = m.profile_id RETURNING p.invoice_seq)
		 UPDATE invoices SET number = n.invoice_seq FROM n WHERE id = '0x' || lpad('3', 64, '0')`)
	var number int
	if err := conn.QueryRowContext(ctx, `SELECT number FROM invoices WHERE id = '0x' || lpad('3', 64, '0')`).Scan(&number); err != nil || number != 2 {
		t.Fatalf("legacy delayed number: %d, %v; want 2", number, err)
	}
}
