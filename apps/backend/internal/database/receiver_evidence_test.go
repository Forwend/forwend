package database

import (
	"context"
	"database/sql"
	"io/fs"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/pressly/goose/v3"
)

func TestDroppingReceiverEvidenceRewindsRecoveryToTheLaggingReceiver(t *testing.T) {
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
	if _, err := provider.UpTo(ctx, 90); err != nil {
		t.Fatal(err)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block, last_finalized_time, last_scanned_time)
		VALUES (42431, 5000, 5000, 1, 1)`)
	exec(`INSERT INTO chain_recoveries (chain_id, completed_block) VALUES (42431, 5000)`)
	exec(`WITH u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:lag') RETURNING id)
		INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u`)
	for n, deadline := range map[string]string{"1": "extract(epoch FROM now())::bigint + 86400", "2": "extract(epoch FROM now())::bigint - 40 * 86400",
		"3": "extract(epoch FROM now())::bigint + 86400"} {
		exec(`INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('0'||$1, 32), id, 42431, 'evm', '0x20c0000000000000000000006a37da5c996874be', 5, `+deadline+` - 3600, `+deadline+`,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    '0x00000000000000000000000000000000000000a'||$1, 'key-'||$1, decode(repeat('00', 32), 'hex') FROM profiles`, n)
	}
	// The watched receiver with money lags at 1200. The one past the watch window, at 100, is the refund authority's;
	// the one never paid, at 300, has nothing to settle or refund.
	exec(`UPDATE receiver_scans SET start_block = 1000, next_block = 1200 WHERE invoice_id = '0x' || repeat('01', 32)`)
	exec(`UPDATE receiver_scans SET start_block = 0, next_block = 100 WHERE invoice_id = '0x' || repeat('02', 32)`)
	exec(`UPDATE receiver_scans SET start_block = 0, next_block = 300 WHERE invoice_id = '0x' || repeat('03', 32)`)
	exec(`INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index, block_hash,
		    block_number, block_time, from_address, to_address, amount, status)
		SELECT 42431, 'evm', token_contract, id, '0x' || repeat('aa', 32), 0, '0x' || repeat('bb', 32), 1300, 1,
		    '0x4444444444444444444444444444444444444444', receive_address, 5, 'confirmed' FROM invoices WHERE id IN
		    ('0x' || repeat('01', 32))`)
	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}
	var next, target int64
	if err := conn.QueryRowContext(ctx, "SELECT next_block, target_block FROM chain_recoveries WHERE chain_id = 42431").
		Scan(&next, &target); err != nil || next != 1200 || target != 5000 {
		t.Fatalf("recovery from %d to %d (%v); want 1200 to 5000", next, target, err)
	}
}
