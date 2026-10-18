package activity

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

// R-108: each transfer says what it was, and money in that Forwend can't classify takes the user's label.
func TestTransferClassification(t *testing.T) {
	pool := open(t)
	ctx := context.Background()
	const mine, second, stranger = "0x000000000000000000000000000000000000000a",
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
	// Another user's wallet.
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
			VALUES (84532, 'evm', $1, $2, $3, $4, $5, 0, $5, $6::bigint, $6::bigint * 100, 1500000, 'confirmed')`,
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

	s := NewService(pool)
	classes := func(from, to int64) map[string]string {
		t.Helper()
		items, err := s.AllTransfers(ctx, profile, time.Unix(from, 0), time.Unix(to, 0))
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
			if it.Labelable() != (out[it.TxHash] == ClassUnclassified || out[it.TxHash] == LabelIncome) {
				t.Fatalf("%s (%s) labelable %v", it.TxHash, out[it.TxHash], it.Labelable())
			}
		}
		return out
	}
	want := map[string]string{paid: ClassInvoice, ownIn: ClassOwnTransfer, ownOut: ClassOwnTransfer, sent: ClassSent,
		unknown: ClassUnclassified, fromBob: ClassUnclassified, theirInvoice: ClassUnclassified, option: ClassInvoice}
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
