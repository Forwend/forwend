package activity

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/ledger/ledgertest"
)

// R-108.
func TestTransferClassification(t *testing.T) {
	pool := open(t)
	ctx := context.Background()
	const mine, second, stranger = "0x1111111111111111111111111111111111111111",
		"0x000000000000000000000000000000000000000b", "0x000000000000000000000000000000000000000c"
	var profile, other string
	if err := pool.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', $1, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id),
		     o AS (INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM u RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w1', 'evm', $2 FROM p UNION ALL SELECT id, 'privy', 'w2', 'evm', $3 FROM o)
		SELECT (SELECT id::text FROM p), (SELECT id::text FROM o)`, usdc, mine, second).Scan(&profile, &other); err != nil {
		t.Fatal(err)
	}
	invoice := addInvoice(t, pool, profile, 1, 0)
	addInvoice(t, pool, other, 2, 0) // the user's other profile's invoice: not this profile's money
	// A second payment option of the invoice, with its own receive address.
	exec(t, pool, `INSERT INTO invoices (id, main_id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		    request_hash)
		SELECT $2, id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, $3, idempotency_key, request_hash
		FROM invoices WHERE id = $1`, invoice, fmt.Sprintf("0x%064x", 3), fmt.Sprintf("0x33%038x", 3))
	const theirs = "0x000000000000000000000000000000000000000d"
	exec(t, pool, `WITH u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:bob') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM u RETURNING id)
		INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		SELECT id, 'privy', 'w3', 'evm', $1 FROM p`, theirs)
	add := func(n int, direction, counterparty string) string {
		t.Helper()
		hash := fmt.Sprintf("0x%064x", n)
		exec(t, pool, `INSERT INTO wallet_transfers (chain_id, chain_family, token_contract, wallet_address, direction,
			    counterparty, tx_hash, log_index, block_hash, block_number, block_time, amount, status)
			VALUES (84532, 'evm', $1, $2, $3, $4, $5, 0, $5, $6::bigint, $6::bigint * 100, 5000000, 'confirmed')`,
			usdc, mine, direction, counterparty, hash, n)
		return hash
	}
	paid := add(1, "in", fmt.Sprintf("0x33%038x", 1)) // from the invoice's receive address
	ownIn := add(2, "in", second)
	ownOut := add(3, "out", second)
	sent := add(4, "out", stranger)
	unknown := add(5, "in", stranger)
	fromBob := add(6, "in", theirs)
	theirInvoice := add(7, "in", fmt.Sprintf("0x33%038x", 2))
	option := add(8, "in", fmt.Sprintf("0x33%038x", 3))
	ledgertest.Settlement(t, pool, invoice, paid, false)
	ledgertest.Settlement(t, pool, fmt.Sprintf("0x%064x", 3), option, true)

	s := NewService(pool)
	classes := func(from, to int64) map[string]string {
		t.Helper()
		items, err := collect(s, profile, time.Unix(from, 0), time.Unix(to, 0))
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]string{}
		for _, it := range items {
			out[it.TxHash] = it.Classification()
			if (it.TxHash == paid || it.TxHash == option) && (it.Invoice == nil || it.Invoice.ID != invoice ||
				it.Invoice.Number != 1) {
				t.Fatalf("%s paid %+v, want the main invoice %s, number 1", it.TxHash, it.Invoice, invoice)
			}
			if it.Labelable() != (out[it.TxHash] == ClassUnclassified || out[it.TxHash] == LabelIncome || out[it.TxHash] == ClassPaymentException) {
				t.Fatalf("%s (%s) labelable %v", it.TxHash, out[it.TxHash], it.Labelable())
			}
		}
		return out
	}
	want := map[string]string{paid: ClassInvoice, ownIn: ClassOwnTransfer, ownOut: ClassOwnTransfer, sent: ClassSent,
		unknown: ClassUnclassified, fromBob: ClassUnclassified, theirInvoice: ClassUnclassified, option: ClassPaymentException}
	if got := classes(0, 1000); !reflect.DeepEqual(got, want) {
		t.Fatalf("classes %v, want %v", got, want)
	}
	if got := classes(200, 400); !reflect.DeepEqual(got, map[string]string{ownIn: ClassOwnTransfer, ownOut: ClassOwnTransfer}) {
		t.Fatalf("the transfers from 200 to before 400: %v", got)
	}

	if err := s.SetLabel(ctx, profile, 84532, strings.ToUpper(unknown[2:]), 0, LabelIncome); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a hash without 0x: %v, want ErrNotFound", err)
	}
	if err := s.SetLabel(ctx, profile, 84532, "0x"+strings.ToUpper(unknown[2:]), 0, LabelIncome); err != nil {
		t.Fatal(err)
	}
	if got := classes(0, 1000)[unknown]; got != LabelIncome {
		t.Fatalf("labelled %s, want income", got)
	}
	for _, hash := range []string{paid, ownIn, ownOut, sent} {
		if err := s.SetLabel(ctx, profile, 84532, hash, 0, LabelOther); !errors.Is(err, ErrNotLabelable) {
			t.Fatalf("label %s (%s): %v, want ErrNotLabelable", hash, want[hash], err)
		}
	}
	for _, c := range []struct {
		profile, hash, label string
		want                 error
	}{
		{profile, unknown, "salary", ErrInvalid},
		{other, unknown, LabelIncome, ErrNotFound},
		{profile, fmt.Sprintf("0x%064x", 99), LabelIncome, ErrNotFound},
	} {
		if err := s.SetLabel(ctx, c.profile, 84532, c.hash, 0, c.label); !errors.Is(err, c.want) {
			t.Fatalf("label %+v: %v", c, err)
		}
	}
	if err := s.SetLabel(ctx, profile, 84532, unknown, 0, ""); err != nil {
		t.Fatal(err)
	}
	if got := classes(0, 1000)[unknown]; got != ClassUnclassified {
		t.Fatalf("cleared %s, want unclassified", got)
	}
}

// R-110.
func TestRecordsValue(t *testing.T) {
	pool := open(t)
	ctx := context.Background()
	const mine = "0x000000000000000000000000000000000000000a"
	var profile string
	if err := pool.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', $1, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w1', 'evm', $2 FROM p)
		SELECT id::text FROM p`, usdc, mine).Scan(&profile); err != nil {
		t.Fatal(err)
	}
	exec(t, pool, `INSERT INTO ecb_rates (currency, day, per_eur) VALUES
		('USD', '2026-10-13', 1), ('GBP', '2026-10-13', 0.5), ('JPY', '2026-10-13', 150),
		('USD', '2026-10-16', 1.2), ('GBP', '2026-10-16', 0.8), ('JPY', '2026-10-16', 180),
		('USD', '2026-10-20', 1.25)`) // the 20th has no GBP or JPY rate
	add := func(n int, at time.Time, amount int64) string {
		t.Helper()
		hash := fmt.Sprintf("0x%064x", n)
		exec(t, pool, `INSERT INTO wallet_transfers (chain_id, chain_family, token_contract, wallet_address, direction,
			    counterparty, tx_hash, log_index, block_hash, block_number, block_time, amount, status)
			VALUES (84532, 'evm', $1, $2, 'in', $3, $4, 0, $4, $5::bigint, $6, $7, 'confirmed')`,
			usdc, mine, payer, hash, n, at.Unix(), amount)
		return hash
	}
	half := add(1, time.Date(2026, 10, 13, 10, 0, 0, 0, time.UTC), 1005000)  // 1.005 USD
	sunday := add(2, time.Date(2026, 10, 18, 9, 0, 0, 0, time.UTC), 1500000) // the Friday's rates
	lastOf15 := add(3, time.Date(2026, 10, 15, 23, 59, 59, 0, time.UTC), 1000000)
	first16 := add(4, time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC), 1200000)
	early := add(5, time.Date(2026, 10, 12, 23, 59, 0, 0, time.UTC), 1000000) // before the first rate
	usdOnly := add(6, time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC), 1000000)
	stale := add(7, time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC), 1000000) // the last rate is 7 days old

	// A session clock off UTC, so the transfer's day is the UTC one only by intent.
	exec(t, pool, `DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(),
		'America/New_York'); END $$`)
	pool.Reset()
	s := NewService(pool)
	values := func() map[string]string {
		t.Helper()
		items, err := collect(s, profile, time.Unix(0, 0), time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC))
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]string{}
		for _, it := range items {
			if amount, day, ok := it.RecordsValue(); ok {
				out[it.TxHash] = amount + " on " + day.Format(time.DateOnly)
			}
		}
		return out
	}
	if got := values(); len(got) != 0 {
		t.Fatalf("values without a records currency: %v", got)
	}
	for currency, want := range map[string]map[string]string{
		"EUR": {half: "1.01 on 2026-10-13", sunday: "1.25 on 2026-10-16", lastOf15: "1.00 on 2026-10-13",
			first16: "1.00 on 2026-10-16", usdOnly: "0.80 on 2026-10-20"},
		"GBP": {half: "0.50 on 2026-10-13", sunday: "1.00 on 2026-10-16", lastOf15: "0.50 on 2026-10-13",
			first16: "0.80 on 2026-10-16"},
		"JPY": {half: "151 on 2026-10-13", sunday: "225 on 2026-10-16", lastOf15: "150 on 2026-10-13",
			first16: "180 on 2026-10-16"},
	} {
		if err := s.SetRecordsCurrency(ctx, profile, currency); err != nil {
			t.Fatal(err)
		}
		if got, err := s.RecordsCurrency(ctx, profile); err != nil || got != currency {
			t.Fatalf("records currency %q %v, want %s", got, err, currency)
		}
		if got := values(); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s values %v, want %v (none for %s or %s)", currency, got, want, early, stale)
		}
	}
	if err := s.SetRecordsCurrency(ctx, profile, "EUR"); err != nil {
		t.Fatal(err)
	}
	rows := 0
	err := s.ExportTransfers(ctx, profile, time.Unix(0, 0), time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC), func(currency string) error {
		if currency != "EUR" {
			t.Fatalf("header currency: %s", currency)
		}
		return s.SetRecordsCurrency(ctx, profile, "GBP")
	}, func(row Transfer) error {
		rows++
		if row.RecordsCurrency != "EUR" {
			t.Fatalf("header and row currency differ: %s", row.RecordsCurrency)
		}
		return nil
	})
	if err != nil || rows == 0 {
		t.Fatalf("snapshot export: %d rows, %v", rows, err)
	}
	for _, bad := range []string{"USD", "XXX", "eur"} {
		if err := s.SetRecordsCurrency(ctx, profile, bad); !errors.Is(err, ErrInvalid) {
			t.Fatalf("records currency %s: %v, want ErrInvalid", bad, err)
		}
	}
	if err := s.SetRecordsCurrency(ctx, profile, ""); err != nil {
		t.Fatal(err)
	}
	if got := values(); len(got) != 0 {
		t.Fatalf("values after clearing: %v", got)
	}
}

func collect(s *Service, profile string, from, to time.Time) ([]Transfer, error) {
	var out []Transfer
	err := s.EachTransfer(context.Background(), profile, from, to, func(t Transfer) error {
		out = append(out, t)
		return nil
	})
	return out, err
}
