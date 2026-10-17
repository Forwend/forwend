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

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5/pgxpool"
)

const usdc = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"

// open migrates a fresh database with Base Sepolia, enabled USDC and one freelancer profile with a wallet and billing
// details (R-92).
func open(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
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
	var profile string
	err = pool.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true) RETURNING chain_id),
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

// A request whose key is being inserted by another transaction waits for it, then returns that invoice. The number
// its own failed insert took is given back: the next invoice gets the one after the winner's.
func TestCreateLosesTheInsertRaceToTheSameKey(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	req := Request{ChainID: 84532, Token: usdc, Amount: "5000000"}

	// The other request's insert, not yet committed.
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
		    'key-1', $4)`, winner, profile, usdc, requestHash(84532, usdc, big.NewInt(5000000), DefaultExpiresIn, Details{}, nil))
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
	select {
	case r := <-done:
		t.Fatalf("Create did not wait for the other insert: %+v", r)
	case <-time.After(300 * time.Millisecond):
	}
	if err := other.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	r := <-done
	if r.err != nil || r.created || r.inv.ID != winner || r.inv.Number != 1 {
		t.Fatalf("got %+v, want the other request's invoice %s with number 1, not created", r, winner)
	}
	next, _, err := NewService(pool).Create(ctx, profile, "key-2", req)
	if err != nil || next.Number != 2 {
		t.Fatalf("next invoice: number %d, %v; want 2", next.Number, err)
	}
}

// Invoices made at once get different numbers with no gap, and a repeat with the same key returns the same number.
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
			numbers[i], errs[i] = inv.Number, err
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
	if err != nil || created || again.Number != numbers[3] {
		t.Fatalf("same key again: number %d, created %v, %v; want %d", again.Number, created, err, numbers[3])
	}
}

func TestOpenInvoicesPerProfileAreCapped(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || lpad(to_hex(n), 64, '0'), $1, 84532, 'evm', $2, 5000000, 4000000000, 4000086400,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    '0x' || lpad(to_hex(n), 40, '0'), 'bulk-' || n, decode(repeat('00', 32), 'hex')
		FROM generate_series(1, $3::int) n`, profile, usdc, MaxOpen); err != nil {
		t.Fatal(err)
	}
	req := Request{ChainID: 84532, Token: usdc, Amount: "5000000"}
	if _, _, err := NewService(pool).Create(ctx, profile, "one-more", req); !errors.Is(err, ErrInvalid) {
		t.Fatalf("over the open invoice cap: %v, want ErrInvalid", err)
	}
}

func TestInvoicesPerProfilePerDayAreCapped(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT '0x' || lpad(to_hex(n), 64, '0'), $1, 84532, 'evm', $2, 5000000, 1, 86401,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    '0x' || lpad(to_hex(n), 40, '0'), 'day-' || n, decode(repeat('00', 32), 'hex')
		FROM generate_series(1, $3::int) n`, profile, usdc, MaxPerDay); err != nil {
		t.Fatal(err)
	}
	req := Request{ChainID: 84532, Token: usdc, Amount: "5000000"}
	if _, _, err := NewService(pool).Create(ctx, profile, "one-more", req); !errors.Is(err, ErrInvalid) {
		t.Fatalf("over the daily cap: %v, want ErrInvalid", err)
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
