package worker

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
)

func TestAlertsNameAStalledChainAndPaidMoneyNotSettled(t *testing.T) {
	ctx := context.Background()
	url := databasetest.Migrated(t, database.Migrate)
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (7, 'evm', 'stalled', true)),
		     cur AS (INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block, last_finalized_time, last_scanned_time)
		            VALUES (7, 100, 100, extract(epoch FROM now())::bigint - 7200, extract(epoch FROM now())::bigint - 7200)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (7, 'evm', '0x3333333333333333333333333333333333333333', 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id)
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('01', 32), id, 7, 'evm', '0x3333333333333333333333333333333333333333', 5000000,
		    extract(epoch FROM now())::bigint + 600, extract(epoch FROM now())::bigint + 3600,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    $1, 'key-1', decode(repeat('00', 32), 'hex') FROM p`, receive); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount,
		    expires_at, settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('02', 32), profile_id, chain_id, chain_family, token_contract, amount,
		    extract(epoch FROM now())::bigint - 7200, extract(epoch FROM now())::bigint - 3600, recipient_address, receive_method,
		    factory_address, '0x00000000000000000000000000000000000000bb', 'key-2', request_hash FROM invoices`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount,
		    expires_at, settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('03', 32), profile_id, chain_id, chain_family, token_contract, amount,
		    extract(epoch FROM now())::bigint + 86400, extract(epoch FROM now())::bigint + 3 * 86400, recipient_address, receive_method,
		    factory_address, '0x00000000000000000000000000000000000000cc', 'key-3', request_hash FROM invoices WHERE id = '0x' || repeat('01', 32)`); err != nil {
		t.Fatal(err)
	}
	// Owed in full two hours ago, yet the finalized balance check still fails.
	if _, err := pool.Exec(ctx, `INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount,
		    expires_at, settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || repeat('04', 32), profile_id, chain_id, chain_family, token_contract, amount,
		    extract(epoch FROM now())::bigint + 86400, extract(epoch FROM now())::bigint + 3 * 86400, recipient_address, receive_method,
		    factory_address, '0x00000000000000000000000000000000000000dd', 'key-4', request_hash FROM invoices WHERE id = '0x' || repeat('01', 32);
		UPDATE invoices SET payment_status = 'detected' WHERE id = '0x' || repeat('04', 32);
		INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index, block_hash,
		    block_number, block_time, from_address, to_address, amount, status)
		VALUES (7, 'evm', '0x3333333333333333333333333333333333333333', '0x' || repeat('04', 32), '0x' || repeat('07', 32), 0,
		    '0x' || repeat('08', 32), 95, 1, '0x00000000000000000000000000000000000000ff', '0x00000000000000000000000000000000000000dd',
		    5000000, 'confirmed');
		WITH t AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id, created_at)
		    SELECT invoice_id, 'deposit', id, now() - interval '2 hours' FROM chain_transfers WHERE invoice_id = '0x' || repeat('04', 32)
		    RETURNING id)
		INSERT INTO ledger_entries (transaction_id, account, amount)
		SELECT id, 'receiver', 5000000 FROM t UNION ALL SELECT id, 'recipient_payable', -5000000 FROM t`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO settlement_intents (invoice_id, created_at, wait)
		VALUES ('0x' || repeat('01', 32), now() - interval '1 hour', 'cap'), ('0x' || repeat('02', 32), now() - interval '3 hours', NULL),
		       ('0x' || repeat('03', 32), now() - interval '3 hours', 'cap')`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO receiver_outflows (invoice_id, chain_id, receiver_address, token_contract, kind,
		    destination, amount, tx_hash, log_index, block_hash, block_number, block_time, verified_block, reconciliation_error, created_at)
		VALUES ('0x' || repeat('01', 32), 7, $1, '0x3333333333333333333333333333333333333333', 'refund',
		    '0x4444444444444444444444444444444444444444', 1, '0x' || repeat('05', 32), 0, '0x' || repeat('06', 32), 90, 1, 90,
		    'unexplained_outflow', now() - interval '1 hour')`, receive); err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	if err := New(pool, nil, 1).alert(ctx); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"ALERT chain scan stalled", "ALERT paid invoice not settled close to its settle deadline",
		"ALERT receiver event not booked", "reason=unexplained_outflow",
		`keeps failing" invoice=0x` + strings.Repeat("04", 32)} {
		if !strings.Contains(logs.String(), want) {
			t.Fatalf("logs lack %q:\n%s", want, logs.String())
		}
	}
	if strings.Contains(logs.String(), strings.Repeat("02", 32)) {
		t.Fatalf("an intent past its settle deadline, which only the refund authority can act on, still alerts:\n%s", logs.String())
	}
	if strings.Contains(logs.String(), strings.Repeat("03", 32)) {
		t.Fatalf("an intent waiting at the daily cap, days before its deadline, alerts:\n%s", logs.String())
	}
}
