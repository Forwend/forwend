package invoice

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// searchText must stay the invoices_search index expression (migration 00032), or every search reads all invoices.
func TestSearchCanUseItsIndex(t *testing.T) {
	pool, profile := open(t)
	ctx := context.Background()
	// Enough invoices that reading them all costs more than the index, as for a real profile.
	if _, err := pool.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash, title)
		SELECT '0x' || md5(i::text) || md5(i::text), $1, 84532, 'evm', $2, 5000000, 1800000000, 1800086400,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    '0x' || left(md5('r' || i) || md5('s' || i), 40), 'key-' || i, sha256(i::text::bytea), 'Work ' || i
		FROM generate_series(1, 2000) i`, profile, usdc); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "VACUUM ANALYZE invoices"); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatal(err)
	}
	rows, err := tx.Query(ctx, "EXPLAIN SELECT id FROM "+invoicesCurrent+" WHERE "+searchText+" ILIKE '%po-4500%'")
	if err != nil {
		t.Fatal(err)
	}
	plan, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(plan, "\n"), "invoices_search") {
		t.Fatalf("the search does not use invoices_search:\n%s", strings.Join(plan, "\n"))
	}
}
