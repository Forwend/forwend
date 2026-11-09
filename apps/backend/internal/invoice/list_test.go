package invoice

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// searchText and paymentSearchText must stay their index expressions (migrations 00032, 00088), or every search reads
// all invoices.
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
	for text, index := range map[string]string{searchText: "invoices_search", paymentSearchText: "invoices_payment_search"} {
		rows, err := tx.Query(ctx, "EXPLAIN SELECT id FROM "+invoicesCurrent+" WHERE "+text+" ILIKE '%po-4500%'")
		if err != nil {
			t.Fatal(err)
		}
		plan, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(strings.Join(plan, "\n"), index+" ") {
			t.Fatalf("the search does not use %s:\n%s", index, strings.Join(plan, "\n"))
		}
	}
}

// A filter tests its raw columns before its CASE, so the columns must hold for every payment the CASE names, or the
// filter drops it.
func TestFilterColumnTestsKeepEveryMatch(t *testing.T) {
	pool, profile := open(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	// Every raw status, settled or not, open or closed, checkout or not.
	n := 0
	for _, payment := range []string{"open", "detected", "partially_paid", "paid", "expired", "expired_partially_paid", "canceled"} {
		for _, settlement := range []string{"none", "pending", "settled"} {
			for _, expires := range []int64{1000, 1800000000} {
				for _, purpose := range []string{"invoice", "checkout"} {
					n++
					id := fmt.Sprintf("0x%064x", n)
					exec(`INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
					    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
					    request_hash, purpose, document_kind)
					    VALUES ($1, $2, 84532, 'evm', $3, 5000000, $4::bigint, $4::bigint + 86400, '0x1111111111111111111111111111111111111111',
					    'evm_create2', '0x2222222222222222222222222222222222222222', $5, $1, decode(repeat('00', 32), 'hex'),
					    $6, CASE WHEN $6 = 'checkout' THEN 'none' ELSE 'invoice' END)`,
						id, profile, usdc, expires, fmt.Sprintf("0x%040x", n), purpose)
					exec(`UPDATE invoices SET payment_status = $2, settlement_status = $3,
					    canceled_at = CASE WHEN $2 = 'canceled' THEN now() END WHERE id = $1`, id, payment, settlement)
				}
			}
		}
	}
	// Money held for the payer on a paid one, and unsettled paid ones whose settle waits or was refused.
	exec(`WITH paid AS (SELECT id, row_number() OVER (ORDER BY id) AS n FROM invoices
	        WHERE payment_status = 'paid' AND settlement_status <> 'settled'),
	    x AS (INSERT INTO ledger_transactions (invoice_id, kind) SELECT id, 'expiry' FROM paid WHERE n = 1 RETURNING id),
	    e AS (INSERT INTO ledger_entries (transaction_id, account, amount)
	        SELECT id, 'receiver', 1 FROM x UNION ALL SELECT id, 'payer_held', -1 FROM x)
	    INSERT INTO settlement_intents (invoice_id, status, wait)
	    SELECT id, CASE WHEN n = 2 THEN 'refused' ELSE 'pending' END, CASE WHEN n = 3 THEN 'cap' END FROM paid WHERE n IN (2, 3)`)
	for _, filter := range []struct {
		sql     string
		columns map[string]string
	}{{ListStatusFilterSQL, StatusColumnsSQL}, {PaymentStateSQL, PaymentStateColumnsSQL}, {WalletSQL, walletColumnsSQL}} {
		for value, columns := range filter.columns {
			var named, dropped int
			if err := pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE NOT (`+columns+`))
			    FROM `+invoicesCurrent+` WHERE profile_id = $1 AND `+filter.sql+` = $2`, profile, value).
				Scan(&named, &dropped); err != nil {
				t.Fatal(err)
			}
			if named == 0 || dropped > 0 {
				t.Errorf("%s: %d payments named, %d of them dropped by %s", value, named, dropped, columns)
			}
		}
	}
}
