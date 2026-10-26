package database

import (
	"context"
	"database/sql"
	"io/fs"
	"reflect"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pressly/goose/v3"
)

// R-134: each merchant profile gets a first store holding its invoices, and the origins of their return links.
func TestStoresForExistingMerchants(t *testing.T) {
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
	if _, err := provider.UpTo(ctx, 57); err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`WITH c AS (INSERT INTO chains (chain_id, chain_family, name) VALUES (84532, 'evm', 'base-sepolia')),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
		            VALUES (84532, 'evm', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 'USDC', 6)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:1') RETURNING id),
		     m AS (INSERT INTO profiles (user_id, kind, name) SELECT id, 'merchant', 'Acme' FROM u),
		     n AS (INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM u)
		INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u`)
	for n, c := range []struct{ kind, name, returnURL string }{
		{"merchant", "Acme", "https://Shop.Example.com:443/thanks?order=1"},
		{"merchant", "Acme", "https://dev.example.com:8443/done"},
		{"merchant", "Acme", "https://shop.example.com/again"},
		// The column's check allows a link with no host; it gives no origin.
		{"merchant", "Acme", "https:///no-host"},
		{"merchant", "Acme", ""},
		{"freelancer", "", "https://me.example/"},
	} {
		exec(`INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
			    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
			    request_hash, return_url)
			SELECT '0x' || lpad(to_hex($1::int), 64, '0'), id, 84532, 'evm', '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
			    1, 1800000000, 1800086400, '0x' || repeat('11', 20), 'evm_create2', '0x' || repeat('22', 20),
			    '0x' || lpad(to_hex($1::int), 40, '0'), $1::text, decode(repeat('00', 32), 'hex'), nullif($4, '')
			FROM profiles WHERE kind = $2 AND coalesce(name, '') = $3`, n+1, c.kind, c.name, c.returnURL)
	}
	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}

	stores := func() map[string][]string {
		t.Helper()
		rows, err := conn.QueryContext(ctx, `SELECT s.name, s.allowed_origins FROM stores s ORDER BY s.name`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		out := map[string][]string{}
		for rows.Next() {
			var name string
			var origins pgtype.FlatArray[string]
			if err := rows.Scan(&name, &origins); err != nil {
				t.Fatal(err)
			}
			out[name] = origins
		}
		return out
	}
	if got, want := stores(), map[string][]string{
		"Acme":       {"https://dev.example.com:8443", "https://shop.example.com"},
		"Main store": {},
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("stores after the migration: %v, want %v", got, want)
	}
	var withStore, withoutStore int
	if err := conn.QueryRowContext(ctx, `SELECT count(*) FILTER (WHERE i.store_id = s.id),
		    count(*) FILTER (WHERE i.store_id IS NULL AND p.kind = 'freelancer')
		FROM invoices i JOIN profiles p ON p.id = i.profile_id LEFT JOIN stores s ON s.profile_id = p.id`).
		Scan(&withStore, &withoutStore); err != nil {
		t.Fatal(err)
	}
	if withStore != 5 || withoutStore != 1 {
		t.Fatalf("%d merchant invoices have their store and %d freelancer invoices none, want 5 and 1", withStore,
			withoutStore)
	}

	exec(`INSERT INTO profiles (user_id, kind, name) SELECT id, 'merchant', 'Bolt' FROM users`)
	exec(`INSERT INTO profiles (user_id, kind, name) SELECT id, 'freelancer', 'Solo' FROM users`)
	if got := stores(); len(got) != 3 || got["Bolt"] == nil || got["Solo"] != nil {
		t.Fatalf("a new merchant profile gets a first store, a freelancer none: %v", got)
	}

	if _, err := provider.DownTo(ctx, 57); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}
}
