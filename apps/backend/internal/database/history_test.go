package database

import (
	"context"
	"database/sql"
	"io/fs"
	"reflect"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/pressly/goose/v3"
)

func TestHistoryForExistingInvoices(t *testing.T) {
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
	if _, err := provider.UpTo(ctx, 48); err != nil {
		t.Fatal(err)
	}
	var profile string
	if err := conn.QueryRowContext(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name) VALUES (84532, 'evm', 'base-sepolia') ON CONFLICT (chain_id) DO NOTHING),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
		            VALUES (84532, 'evm', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 'USDC', 6)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:1') RETURNING id)
		INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id::text`).Scan(&profile); err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for n, at := range []string{"2026-10-01T08:00:00Z", "2026-10-01T09:00:00Z", "2026-10-01T10:00:00Z",
		"2026-10-01T10:15:00Z"} {
		exec(`INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
			    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
			    request_hash, created_at)
			VALUES ('0x' || lpad(to_hex($1::int), 64, '0'), $2, 84532, 'evm',
			    '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 1, 1800000000, 1800086400, '0x' || repeat('11', 20),
			    'evm_create2', '0x' || repeat('22', 20), '0x' || lpad(to_hex($1::int), 40, '0'), $1::text,
			    decode(repeat('00', 32), 'hex'), $3)`, n+1, profile, at)
	}
	exec(`UPDATE invoices SET payment_status = 'canceled', canceled_at = '2026-10-01T11:00:00Z'
		WHERE id = '0x' || lpad('2', 64, '0')`)
	third := "0x" + "0000000000000000000000000000000000000000000000000000000000000003"
	exec("UPDATE invoices SET payment_status = 'paid', settlement_status = 'pending' WHERE id = $1", third)
	exec(`INSERT INTO settlement_intents (invoice_id, status, tx_hash, created_at, updated_at)
		VALUES ($1, 'confirmed', '0x' || repeat('ab', 32), '2026-10-01T10:30:00Z', '2026-10-01T12:00:00Z')`, third)
	exec("UPDATE invoices SET settlement_status = 'settled' WHERE id = $1", third)
	exec("UPDATE invoices SET payment_status = 'expired' WHERE id = '0x' || lpad('4', 64, '0')")
	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}

	rows, err := conn.QueryContext(ctx, `SELECT right(invoice_id, 1) || ' ' || kind || ' by ' || actor ||
		    coalesce(' ' || (data->>'txHash'), '') || CASE WHEN data->>'backfilled' = 'true' THEN '' ELSE ' new' END
		FROM history_events ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var event string
		if err := rows.Scan(&event); err != nil {
			t.Fatal(err)
		}
		got = append(got, event)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"1 invoice.created by owner",
		"2 invoice.created by owner",
		"3 invoice.created by owner",
		"4 invoice.created by owner",
		"3 invoice.paid by system",
		"2 invoice.canceled by owner",
		"3 invoice.settled by system 0x" + "abababababababababababababababababababababababababababababababab",
		"4 invoice.expired by system", // at its expiry, 2027-01-15
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("history\n got %q\nwant %q", got, want)
	}
}
