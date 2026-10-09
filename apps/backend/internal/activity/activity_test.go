package activity

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	usdc    = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
	payer   = "0x5555555555555555555555555555555555555555"
	created = "2026-10-01T10:00:00Z"
)

func open(t *testing.T) *pgxpool.Pool {
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
	return pool
}

func exec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

// invoice n of profile, made at minute minute after created; its receive address is 0x33…n.
func addInvoice(t *testing.T, pool *pgxpool.Pool, profile string, n, minute int) string {
	t.Helper()
	id := fmt.Sprintf("0x%064x", n)
	exec(t, pool, `INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		    request_hash, created_at)
		VALUES ($1, $2, 84532, 'evm', $3, 5000000, 1800000000, 1800086400, '0x1111111111111111111111111111111111111111',
		    'evm_create2', '0x4444444444444444444444444444444444444444', $4, $1, decode(repeat('00', 32), 'hex'),
		    $5::timestamptz + make_interval(mins => $6))`, id, profile, usdc, fmt.Sprintf("0x33%038x", n), created, minute)
	return id
}

func addDeposit(t *testing.T, pool *pgxpool.Pool, invoice string, n, minute int, status string) {
	t.Helper()
	exec(t, pool, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status, created_at)
		SELECT 84532, 'evm', $1, $2, $3, 0, $3, 1, 1, $4, receive_address, 1000000, $5,
		    $6::timestamptz + make_interval(mins => $7) FROM invoices WHERE id = $2`,
		usdc, invoice, fmt.Sprintf("0x%064x", n), payer, status, created, minute)
}

func TestListNewestFirstInPages(t *testing.T) {
	pool := open(t)
	var profile, other, empty string
	if err := pool.QueryRow(context.Background(), `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', $1, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM u RETURNING id),
		     o AS (INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM u RETURNING id),
		     e AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id)
		SELECT (SELECT id::text FROM p), (SELECT id::text FROM o), (SELECT id::text FROM e)`, usdc).
		Scan(&profile, &other, &empty); err != nil {
		t.Fatal(err)
	}
	s := NewService(pool)
	ctx := context.Background()

	first, err := s.List(ctx, empty, "", DefaultLimit)
	if err != nil || len(first.Items) != 0 || first.NextCursor != "" {
		t.Fatalf("new profile: %+v, %v; want an empty list", first, err)
	}

	a := addInvoice(t, pool, profile, 1, 0)
	b := addInvoice(t, pool, profile, 2, 5)
	c := addInvoice(t, pool, profile, 3, 5) // same time as b: ties broken by kind and key
	addDeposit(t, pool, a, 10, 7, "confirmed")
	addDeposit(t, pool, b, 11, 9, "detected")
	addDeposit(t, pool, b, 12, 9, "reorged") // left out
	addInvoice(t, pool, other, 4, 8)         // another profile's: left out
	want := []string{"deposit " + b, "deposit " + a, "invoice " + c, "invoice " + b, "invoice " + a}

	// Every page size, so a page boundary falls between every two items, including b and c with the same time.
	for limit := 1; limit <= len(want); limit++ {
		var got []string
		cursor := ""
		for pages := 1; ; pages++ {
			page, err := s.List(ctx, profile, cursor, limit)
			if err != nil {
				t.Fatal(err)
			}
			for _, it := range page.Items {
				got = append(got, it.Kind+" "+it.InvoiceID)
			}
			if cursor = page.NextCursor; cursor == "" {
				if wantPages := (len(want) + limit - 1) / limit; pages != wantPages {
					t.Fatalf("limit %d: %d pages, want %d", limit, pages, wantPages)
				}
				break
			}
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("limit %d: got %v\nwant %v", limit, got, want)
		}
	}

	top, _ := s.List(ctx, profile, "", 1)
	d := top.Items[0]
	if d.Status != "detected" || d.TxHash != fmt.Sprintf("0x%064x", 11) || d.Amount.Int64() != 1000000 || d.ChainID != 84532 ||
		d.Symbol != "USDC" || d.Decimals != 6 {
		t.Fatalf("deposit item %+v", d)
	}
	inv, _ := s.List(ctx, profile, "", 3)
	if i := inv.Items[2]; i.Status != "open" || i.SettlementStatus != "none" || i.Amount.Int64() != 5000000 || i.Token != usdc {
		t.Fatalf("invoice item %+v", i)
	}
}

func TestListRefusesBadInput(t *testing.T) {
	s := NewService(open(t))
	ctx := context.Background()
	profile := "00000000-0000-0000-0000-000000000000"
	for _, c := range []struct {
		cursor string
		limit  int
	}{{"", 0}, {"", MaxLimit + 1}, {"not base64!", 10}, {encode(time.Time{}, "payment", "x"), 10}, {"MTIz", 10}} {
		if _, err := s.List(ctx, profile, c.cursor, c.limit); !errors.Is(err, ErrInvalid) {
			t.Fatalf("cursor %q limit %d: %v, want ErrInvalid", c.cursor, c.limit, err)
		}
	}
}
