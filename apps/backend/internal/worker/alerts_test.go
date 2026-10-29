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
	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
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
	if _, err := pool.Exec(ctx, `INSERT INTO settlement_intents (invoice_id, created_at)
		VALUES ('0x' || repeat('01', 32), now() - interval '1 hour'), ('0x' || repeat('02', 32), now() - interval '3 hours')`); err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	if err := New(pool, nil, 1).alert(ctx); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"ALERT chain scan stalled", "ALERT paid invoice not settled close to its settle deadline"} {
		if !strings.Contains(logs.String(), want) {
			t.Fatalf("logs lack %q:\n%s", want, logs.String())
		}
	}
	if strings.Contains(logs.String(), strings.Repeat("02", 32)) {
		t.Fatalf("an intent past its settle deadline, which only the refund authority can act on, still alerts:\n%s", logs.String())
	}
}
