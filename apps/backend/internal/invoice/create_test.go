package invoice

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const usdc = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"

func TestCreationAndExpiryUseOneClock(t *testing.T) {
	pool, profile := open(t)
	s := NewService(pool)
	expires := int64(7200)
	inv, _, err := s.Create(t.Context(), profile, "creation-clock", Request{
		AmountUSD: "1", ExpiresInSeconds: &expires,
		Lines: []LineRequest{{Description: "Work", Quantity: "1", UnitPrice: "1"}},
		Caller: Caller{Before: func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, "SELECT pg_sleep(1.1)")
			return err
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if lifetime := inv.ExpiresAt.Sub(inv.CreatedAt.Truncate(time.Second)); lifetime != 2*time.Hour {
		t.Fatalf("created=%s expiry=%s lifetime=%s", inv.CreatedAt, inv.ExpiresAt, lifetime)
	}
}

func open(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	ctx := context.Background()
	url := databasetest.Migrated(t, database.Migrate)
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var profile string
	err = pool.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true) ON CONFLICT (chain_id) DO UPDATE SET enabled = true RETURNING chain_id),
		     cur AS (INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) SELECT chain_id, 0, 0 FROM c),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', $1, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w1', 'evm', '0x1111111111111111111111111111111111111111' FROM p),
		     b AS (INSERT INTO profile_billing_details (profile_id, name, address, country, contact_email)
		           SELECT id, 'Alice', 'Main St 1', 'DE', 'alice@example.com' FROM p)
		SELECT id::text FROM p`, usdc).Scan(&profile)
	if err != nil {
		t.Fatal(err)
	}
	return pool, profile
}

func TestCreateLosesTheInsertRaceToTheSameKey(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	req := Request{ChainID: 84532, Token: usdc, Amount: "5000000"}

	other, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Rollback(ctx)
	winner := "0xab" + strings.Repeat("0", 60) + "cd"
	_, err = other.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		VALUES ($1, $2, 84532, 'evm', $3, 5000000, 1800000000, 1800086400, '0x1111111111111111111111111111111111111111',
		    'evm_create2', '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333',
		    'key-1', $4)`, winner, profile, usdc, requestHash(Request{}, 84532, usdc, big.NewInt(5000000), DefaultExpiresIn, nil))
	if err != nil {
		t.Fatal(err)
	}

	type result struct {
		inv     Invoice
		created bool
		err     error
	}
	done := make(chan result)
	go func() {
		inv, created, err := NewService(pool).Create(ctx, profile, "key-1", req)
		done <- result{inv, created, err}
	}()
	waitForLocks(t, pool, "%", 1)
	if err := other.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	r := <-done
	if r.err != nil || r.created || r.inv.ID != winner || *r.inv.Number != 1 {
		t.Fatalf("got %+v, want the other request's invoice %s with number 1, not created", r, winner)
	}
	next, _, err := NewService(pool).Create(ctx, profile, "key-2", req)
	if err != nil || *next.Number != 2 {
		t.Fatalf("next invoice: number %v, %v; want 2", next.Number, err)
	}
}

func TestCreateCapsReadOnlyOpenAndRecentInvoices(t *testing.T) {
	pool, profile := open(t)
	ctx := context.Background()
	// Enough rows that the planner prefers the indexes.
	if _, err := pool.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash, created_at)
		SELECT '0x' || md5(i::text) || md5(i::text), $1, 84532, 'evm', $2, 5000000, 1000, 87400,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    '0x' || left(md5('r' || i) || md5('s' || i), 40), 'key-' || i, sha256(i::text::bytea), now() - interval '7 days'
		FROM generate_series(1, 2000) i`, profile, usdc); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "VACUUM ANALYZE invoices"); err != nil {
		t.Fatal(err)
	}
	plans := databasetest.Plans(t, pool.Config().ConnString(), func(p *pgxpool.Pool) {
		req := Request{ChainID: 84532, Token: usdc, Amount: "5000000"}
		if _, _, err := NewService(p).Create(ctx, profile, "key-new", req); err != nil {
			t.Fatal(err)
		}
	})
	for _, index := range []string{"invoices_profile_closes", "invoices_profile_created"} {
		if !strings.Contains(plans, index+" ") {
			t.Errorf("no query uses %s:\n%s", index, plans)
		}
	}
}

func TestCreateNumbersInvoicesAtOnce(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	req := Request{ChainID: 84532, Token: usdc, Amount: "5000000"}
	numbers := make([]int64, 10)
	errs := make([]error, len(numbers))
	var wg sync.WaitGroup
	for i := range numbers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			inv, _, err := s.Create(ctx, profile, fmt.Sprintf("key-%d", i), req)
			if errs[i] = err; err == nil {
				numbers[i] = *inv.Number
			}
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	want := []int64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	if got := slices.Sorted(slices.Values(numbers)); !reflect.DeepEqual(got, want) {
		t.Fatalf("numbers %v, want each of %v once", got, want)
	}
	again, created, err := s.Create(ctx, profile, "key-3", req)
	if err != nil || created || *again.Number != numbers[3] {
		t.Fatalf("same key again: number %v, created %v, %v; want %d", again.Number, created, err, numbers[3])
	}
}

func TestOpenInvoicesPerProfileAreCapped(t *testing.T) {
	for _, terms := range []string{"4000000000, 4000086400, NULL", "1000, 4000086400, 4000000000"} {
		ctx := context.Background()
		pool, profile := open(t)
		// The guard refuses an invoice that starts reopened.
		if _, err := pool.Exec(ctx, "ALTER TABLE invoices DISABLE TRIGGER invoices_guard"); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
			    reopened_until, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
			    request_hash, created_at)
			SELECT '0x' || lpad(to_hex(n), 64, '0'), $1, 84532, 'evm', $2, 5000000, `+terms+`,
			    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
			    '0x' || lpad(to_hex(n), 40, '0'), 'bulk-' || n, decode(repeat('00', 32), 'hex'), now() - interval '2 days'
			FROM generate_series(1, $3::int) n`, profile, usdc, MaxOpen); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, "ALTER TABLE invoices ENABLE TRIGGER invoices_guard"); err != nil {
			t.Fatal(err)
		}
		req := Request{ChainID: 84532, Token: usdc, Amount: "5000000"}
		if _, _, err := NewService(pool).Create(ctx, profile, "one-more", req); !errors.Is(err, ErrInvalid) ||
			!strings.Contains(err.Error(), "open at once") {
			t.Fatalf("%s: over the open invoice cap: %v, want ErrInvalid", terms, err)
		}
	}
}

func TestPaymentLinkInvoicesHaveTheirOwnQuota(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	link := "00000000-0000-0000-0000-0000000000aa"
	if _, err := pool.Exec(ctx, `INSERT INTO payment_links (id, profile_id, slug, title) VALUES ($1, $2, 'abcdefghijkl', 'Seat')`,
		link, profile); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash, link_id)
		SELECT '0x' || lpad(to_hex(n), 64, '0'), $1, 84532, 'evm', $2, 5000000, 1, 86401,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    '0x' || lpad(to_hex(n), 40, '0'), 'link-' || n, decode(repeat('00', 32), 'hex'), $4
		FROM generate_series(1, $3::int) n`, profile, usdc, MaxPerDay, link); err != nil {
		t.Fatal(err)
	}
	req := Request{ChainID: 84532, Token: usdc, Amount: "5000000"}
	if _, _, err := NewService(pool).Create(ctx, profile, "owner", req); err != nil {
		t.Fatalf("the owner's invoice after a day of link invoices: %v", err)
	}
	req.Caller.LinkID = link
	if _, _, err := NewService(pool).Create(ctx, profile, "payer", req); !errors.Is(err, ErrInvalid) ||
		!strings.Contains(err.Error(), "payment links") {
		t.Fatalf("over the links' daily quota: %v, want ErrInvalid", err)
	}
}

func TestOwnerInvoicesLeaveTheLinksQuota(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	link := "00000000-0000-0000-0000-0000000000aa"
	if _, err := pool.Exec(ctx, `INSERT INTO payment_links (id, profile_id, slug, title) VALUES ($1, $2, 'abcdefghijkl', 'Seat')`,
		link, profile); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || lpad(to_hex(n), 64, '0'), $1, 84532, 'evm', $2, 5000000, 1, 86401,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    '0x' || lpad(to_hex(n), 40, '0'), 'day-' || n, decode(repeat('00', 32), 'hex')
		FROM generate_series(1, $3::int) n`, profile, usdc, MaxPerDay); err != nil {
		t.Fatal(err)
	}
	req := Request{ChainID: 84532, Token: usdc, Amount: "5000000", Caller: Caller{LinkID: link}}
	if _, _, err := NewService(pool).Create(ctx, profile, "payer", req); err != nil {
		t.Fatalf("a payer's invoice after a day of the owner's: %v", err)
	}
}

func TestConcurrentRetryReplaysWhenTheWinnerUsesTheLastDailySlot(t *testing.T) {
	ctx := t.Context()
	pool, profileID := open(t)
	if _, err := pool.Exec(ctx, `INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount,
		expires_at, settle_deadline, recipient_address, receive_method, factory_address, receive_address,
		idempotency_key, request_hash)
		SELECT '0x' || lpad(to_hex(n), 64, '0'), $1, 84532, 'evm', $2, 1, 1, 86401,
		'0x' || repeat('11', 20), 'evm_create2', '0x' || repeat('22', 20), '0x' || lpad(to_hex(n), 40, '0'),
		'day-' || n, decode(repeat('00', 32), 'hex') FROM generate_series(1, $3::int) n`, profileID, usdc, MaxPerDay-1); err != nil {
		t.Fatal(err)
	}
	lock, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(ctx)
	if _, err := lock.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE", profileID); err != nil {
		t.Fatal(err)
	}
	type result struct {
		inv     Invoice
		created bool
		err     error
	}
	results := make(chan result, 2)
	for range 2 {
		go func() {
			inv, created, err := NewService(pool).Create(ctx, profileID, "same-purchase",
				Request{AmountUSD: "2", Caller: Caller{Purpose: PurposeCheckout}})
			results <- result{inv, created, err}
		}()
	}
	waitForLocks(t, pool, "%profiles%FOR NO KEY UPDATE%", 2)
	if err := lock.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	a, b := <-results, <-results
	if a.err != nil || b.err != nil || a.inv.ID != b.inv.ID || a.created == b.created {
		t.Fatalf("first: id %s, created %v, error %v; second: id %s, created %v, error %v",
			a.inv.ID, a.created, a.err, b.inv.ID, b.created, b.err)
	}
}

func waitForLocks(t *testing.T, pool *pgxpool.Pool, query string, n int) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		var waiting int
		if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
			AND wait_event_type = 'Lock' AND query LIKE $1`, query).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting >= n {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d queries like %q wait on a lock, want %d", waiting, query, n)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func capRace(t *testing.T, fill, count string, limit, n int) (ok, rows int) {
	t.Helper()
	ctx := context.Background()
	pool, profile := open(t)
	if _, err := pool.Exec(ctx, fill, profile, usdc, limit-1); err != nil {
		t.Fatal(err)
	}
	s := NewService(pool)
	req := Request{ChainID: 84532, Token: usdc, Amount: "5000000"}
	var wg sync.WaitGroup
	var mu sync.Mutex
	start := make(chan struct{})
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if _, _, err := s.Create(ctx, profile, fmt.Sprintf("race-%d", i), req); err == nil {
				mu.Lock()
				ok++
				mu.Unlock()
			}
		}()
	}
	close(start)
	wg.Wait()
	if err := pool.QueryRow(ctx, count, profile).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	return ok, rows
}

func TestDailyCapHoldsUnderConcurrentCreates(t *testing.T) {
	ok, rows := capRace(t, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || lpad(to_hex(n), 64, '0'), $1, 84532, 'evm', $2, 5000000, 1, 86401,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    '0x' || lpad(to_hex(n), 40, '0'), 'day-' || n, decode(repeat('00', 32), 'hex')
		FROM generate_series(1, $3::int) n`,
		`SELECT count(*) FROM invoices WHERE profile_id = $1 AND created_at > now() - interval '1 day'`, MaxPerDay, 20)
	if rows > MaxPerDay || ok != 1 {
		t.Fatalf("20 concurrent creates at %d of %d a day: %d succeeded, %d invoices today; want 1 and %d",
			MaxPerDay-1, MaxPerDay, ok, rows, MaxPerDay)
	}
}

func TestOpenCapHoldsUnderConcurrentCreates(t *testing.T) {
	ok, rows := capRace(t, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash,
		    created_at)
		SELECT '0x' || lpad(to_hex(n), 64, '0'), $1, 84532, 'evm', $2, 5000000, 4000000000, 4000086400,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    '0x' || lpad(to_hex(n), 40, '0'), 'bulk-' || n, decode(repeat('00', 32), 'hex'), now() - interval '2 days'
		FROM generate_series(1, $3::int) n`,
		`SELECT count(*) FROM invoices WHERE profile_id = $1 AND expires_at > extract(epoch FROM now())::bigint`, MaxOpen, 20)
	if rows > MaxOpen || ok != 1 {
		t.Fatalf("20 concurrent creates at %d of %d open: %d succeeded, %d open invoices; want 1 and %d",
			MaxOpen-1, MaxOpen, ok, rows, MaxOpen)
	}
}
