package activity

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/search"
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

	first, err := s.List(ctx, empty, "", DefaultLimit, "", search.Query{})
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
			page, err := s.List(ctx, profile, cursor, limit, "", search.Query{})
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

	top, _ := s.List(ctx, profile, "", 1, "", search.Query{})
	d := top.Items[0]
	if d.Status != "detected" || d.TxHash != fmt.Sprintf("0x%064x", 11) || d.Amount.Int64() != 1000000 || d.ChainID != 84532 ||
		d.Symbol != "USDC" || d.Decimals != 6 {
		t.Fatalf("deposit item %+v", d)
	}
	inv, _ := s.List(ctx, profile, "", 3, "", search.Query{})
	if i := inv.Items[2]; i.Status != "open" || i.SettlementStatus != "none" || i.Amount.Int64() != 5000000 || i.Token != usdc ||
		i.TxHash != "" {
		t.Fatalf("invoice item %+v", i)
	}

	settle := fmt.Sprintf("0x%064x", 99)
	exec(t, pool, `WITH i AS (INSERT INTO settlement_intents (invoice_id, status, tx_hash) VALUES ($1, 'confirmed', $2))
		UPDATE invoices SET settlement_status = 'settled' WHERE id = $1`, a, settle)
	all, _ := s.List(ctx, profile, "", DefaultLimit, "", search.Query{})
	if i := all.Items[4]; i.InvoiceID != a || i.SettlementStatus != "settled" || i.TxHash != settle {
		t.Fatalf("settled invoice item %+v, want tx hash %s", i, settle)
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
		if _, err := s.List(ctx, profile, c.cursor, c.limit, "", search.Query{}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("cursor %q limit %d: %v, want ErrInvalid", c.cursor, c.limit, err)
		}
	}
}

// D-26: booked deposits follow the ledger; unbooked ones the ledger's own rule (late, final invoice, other option).
func TestListMarksHeldDeposits(t *testing.T) {
	pool := open(t)
	var profile string
	if err := pool.QueryRow(context.Background(), `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', $1, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id)
		INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM u RETURNING id::text`, usdc).Scan(&profile); err != nil {
		t.Fatal(err)
	}
	canceled := addInvoice(t, pool, profile, 1, 0)
	exec(t, pool, "UPDATE invoices SET payment_status = 'canceled', canceled_at = now() WHERE id = $1", canceled)
	addDeposit(t, pool, canceled, 11, 1, "detected")
	late := addInvoice(t, pool, profile, 2, 0)
	addDeposit(t, pool, late, 12, 2, "confirmed")
	exec(t, pool, "UPDATE chain_transfers SET block_time = 1900000000 WHERE invoice_id = $1", late)
	main := addInvoice(t, pool, profile, 3, 0)
	option := fmt.Sprintf("0x%064x", 4)
	exec(t, pool, `INSERT INTO invoices (id, main_id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		    request_hash, created_at)
		SELECT $2, id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, $3, idempotency_key, request_hash, created_at FROM invoices WHERE id = $1`,
		main, option, fmt.Sprintf("0x33%038x", 4))
	exec(t, pool, "UPDATE invoices SET chosen_id = $1 WHERE id = $1", main)
	addDeposit(t, pool, option, 13, 3, "detected")
	open := addInvoice(t, pool, profile, 5, 0)
	addDeposit(t, pool, open, 14, 4, "detected")
	paidOver := addInvoice(t, pool, profile, 8, 0) // money after paid, not booked yet
	exec(t, pool, "UPDATE invoices SET payment_status = 'paid' WHERE id = $1", paidOver)
	addDeposit(t, pool, paidOver, 17, 7, "detected")
	expired := addInvoice(t, pool, profile, 9, 0)
	exec(t, pool, "UPDATE invoices SET payment_status = 'expired' WHERE id = $1", expired)
	addDeposit(t, pool, expired, 18, 8, "detected")
	// Booked: the ledger says what reached the owner. All of the first held, the second to the owner, the third to the
	// owner until the invoice expired partly paid and the expiry book moved it to the payer.
	paidHeld := addInvoice(t, pool, profile, 6, 0)
	addDeposit(t, pool, paidHeld, 15, 5, "confirmed")
	paid := addInvoice(t, pool, profile, 7, 0)
	addDeposit(t, pool, paid, 16, 6, "confirmed")
	partial := addInvoice(t, pool, profile, 10, 0)
	addDeposit(t, pool, partial, 19, 9, "confirmed")
	for inv, account := range map[string]string{paidHeld: "payer_held", paid: "recipient_payable", partial: "recipient_payable"} {
		exec(t, pool, `WITH x AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
			           SELECT $1, 'deposit', id FROM chain_transfers WHERE invoice_id = $1 RETURNING id)
			INSERT INTO ledger_entries (transaction_id, account, amount) SELECT id, 'receiver', 1000000 FROM x
			UNION ALL SELECT id, $2, -1000000 FROM x`, inv, account)
	}

	exec(t, pool, "UPDATE invoices SET payment_status = 'expired_partially_paid' WHERE id = $1", partial)

	held := map[string]bool{}
	s := NewService(pool)
	all, err := s.List(context.Background(), profile, "", DefaultLimit, "", search.Query{})
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range all.Items {
		if it.Kind == Deposit {
			held[it.InvoiceID] = it.Held
		}
	}
	want := map[string]bool{canceled: true, late: true, main: true, open: false, paidOver: true, expired: true,
		paidHeld: true, paid: false, partial: true}
	if !reflect.DeepEqual(held, want) {
		t.Fatalf("held %v, want %v", held, want)
	}
	for _, filter := range []string{"open", "paid"} {
		page, err := s.List(context.Background(), profile, "", DefaultLimit, filter, search.Query{})
		if err != nil {
			t.Fatal(err)
		}
		for _, it := range page.Items {
			if it.Kind == Deposit && it.Held {
				t.Fatalf("held deposit of %s under %s", it.InvoiceID, filter)
			}
		}
	}
}
