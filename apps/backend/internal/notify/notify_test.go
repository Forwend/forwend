package notify

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/email"
	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const web = "https://app.example"

// fake records what it sends; fail makes every send fail.
type fake struct {
	mu   sync.Mutex
	sent []email.Message
	keys []string // of every try, failed or not
	fail bool
}

func (f *fake) Send(_ context.Context, m email.Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.keys = append(f.keys, m.Key)
	if f.fail {
		return errors.New("Resend answered 503")
	}
	f.sent = append(f.sent, m)
	return nil
}

// setup makes a database with one user (login email as sign-up stores it: "" when the account has none), profile and
// 5 USDC invoice on Base Sepolia.
func setup(t *testing.T, login string) (*pgxpool.Pool, string) {
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
	id := "0x" + strings.Repeat("ab", 32)
	exec(t, pool, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', '0x00000000000000000000000000000000000000ee', 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id, login_email) VALUES ('did:privy:a', $2) RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id)
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash, sender_name)
		SELECT $1, id, 84532, 'evm', '0x00000000000000000000000000000000000000ee', 5000000, 2000000000, 2000086400,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    '0x3333333333333333333333333333333333333333', 'k', decode(repeat('00', 32), 'hex'), 'Mara Ilić' FROM p`, id, login)
	return pool, id
}

func exec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func queue(t *testing.T, pool *pgxpool.Pool, kind, invoice string, amount *big.Int) {
	t.Helper()
	if err := pgx.BeginFunc(context.Background(), pool, func(tx pgx.Tx) error {
		return outbox.Queue(context.Background(), tx, kind, invoice, amount)
	}); err != nil {
		t.Fatal(err)
	}
}

func count(t *testing.T, pool *pgxpool.Pool, where string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM outbox_events WHERE "+where).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// R-80: one email per event, keyed by the event, naming the invoice, amount and network, linking the invoice.
func TestDeliverSendsOneEmailPerEvent(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	queue(t, pool, outbox.Paid, id, nil)
	queue(t, pool, outbox.Settled, id, nil)
	queue(t, pool, outbox.Held, id, big.NewInt(1500000))
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, web); err != nil {
		t.Fatal(err)
	}
	if err := Deliver(context.Background(), pool, f, web); err != nil { // nothing left: nothing sent twice
		t.Fatal(err)
	}
	if len(f.sent) != 3 || count(t, pool, "published_at IS NULL") != 0 {
		t.Fatalf("sent %d, unpublished %d", len(f.sent), count(t, pool, "published_at IS NULL"))
	}
	for i, want := range []struct{ subject, text string }{
		{"INV-0001 paid: 5.00 USDC", "INV-0001 was paid: 5.00 USDC on Base Sepolia."},
		{"INV-0001: 5.00 USDC is in your wallet", "reached your wallet: 5.00 USDC on Base Sepolia."},
		{"INV-0001: 1.50 USDC held for the payer", "a partial payment when the checkout closed"},
	} {
		m := f.sent[i]
		if m.To != "owner@example.com" || m.Subject != want.subject || !strings.Contains(m.Text, want.text) ||
			!strings.Contains(m.Text, web+"/app/invoices/"+id) || !strings.Contains(m.Text, web+"/app/notifications") ||
			!strings.HasPrefix(m.Key, fmt.Sprintf("forwend-%s-%d-", id, i+1)) {
			t.Fatalf("email %d: %+v", i, m)
		}
	}
}

// Email off for the profile, or an account without a login email: nothing is sent and nothing waits.
func TestDeliverSkipsWhenOffOrNoAddress(t *testing.T) {
	for _, c := range []struct {
		name, login string
		off         bool
	}{{"off", "owner@example.com", true}, {"no login email", "", false}} {
		t.Run(c.name, func(t *testing.T) {
			pool, id := setup(t, c.login)
			if c.off {
				exec(t, pool, "UPDATE profiles SET email_notifications = false")
			}
			queue(t, pool, outbox.Paid, id, nil)
			f := &fake{}
			if err := Deliver(context.Background(), pool, f, web); err != nil {
				t.Fatal(err)
			}
			if len(f.sent) != 0 || count(t, pool, "published_at IS NOT NULL") != 1 {
				t.Fatalf("sent %d, published %d", len(f.sent), count(t, pool, "published_at IS NOT NULL"))
			}
		})
	}
}

// A failed send waits its backoff before the next try, and after MaxAttempts the event is given up.
func TestDeliverRetriesWithBackoffThenGivesUp(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	queue(t, pool, outbox.Paid, id, nil)
	f := &fake{fail: true}
	if err := Deliver(context.Background(), pool, f, web); err != nil {
		t.Fatal(err)
	}
	if count(t, pool, "attempts = 1 AND next_attempt_at > now() + interval '50 seconds' AND published_at IS NULL") != 1 {
		t.Fatal("after one failure: want attempts 1 and a wait of about a minute")
	}
	// A failure ends the round: of two events due at once, one is tried against a failing Resend, the other waits.
	queue(t, pool, outbox.Paid, id, nil)
	queue(t, pool, outbox.Paid, id, nil)
	if err := Deliver(context.Background(), pool, f, web); err != nil {
		t.Fatal(err)
	}
	if count(t, pool, "id > 1 AND attempts = 1") != 1 || count(t, pool, "id > 1 AND attempts = 0") != 1 {
		t.Fatal("a failed send did not end the round")
	}
	exec(t, pool, "DELETE FROM outbox_events WHERE id > 1")
	if err := Deliver(context.Background(), pool, f, web); err != nil { // not due yet: no second try now
		t.Fatal(err)
	}
	if count(t, pool, "attempts = 1") != 1 {
		t.Fatal("tried again before its backoff")
	}
	exec(t, pool, "UPDATE outbox_events SET attempts = $1, next_attempt_at = now()", MaxAttempts-1)
	if err := Deliver(context.Background(), pool, f, web); err != nil {
		t.Fatal(err)
	}
	if count(t, pool, "failed_at IS NOT NULL AND published_at IS NULL") != 1 {
		t.Fatal("not given up after MaxAttempts")
	}
	f.fail = false
	if err := Deliver(context.Background(), pool, f, web); err != nil || len(f.sent) != 0 {
		t.Fatalf("a given-up event was sent: %d (%v)", len(f.sent), err)
	}
}

// A retry is the same request to Resend: a send whose answer was lost (Resend delivered it, then the connection
// dropped) is retried under the same Idempotency-Key, which Resend answers without sending again.
func TestRetryKeepsTheIdempotencyKey(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	queue(t, pool, outbox.Paid, id, nil)
	f := &fake{fail: true}
	if err := Deliver(context.Background(), pool, f, web); err != nil {
		t.Fatal(err)
	}
	exec(t, pool, "UPDATE outbox_events SET next_attempt_at = now()")
	f.fail = false
	if err := Deliver(context.Background(), pool, f, web); err != nil {
		t.Fatal(err)
	}
	if len(f.keys) != 2 || len(f.sent) != 1 || f.keys[0] != f.keys[1] {
		t.Fatalf("keys of the failed try and the retry %v: want one key twice", f.keys)
	}
}

// Two workers at once (a deploy's overlap) never send one event twice: each claims with SKIP LOCKED.
func TestDeliverClaimsEachEventOnce(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	for range 10 {
		queue(t, pool, outbox.Paid, id, nil)
	}
	f := &fake{}
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			if err := Deliver(context.Background(), pool, f, web); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	keys := map[string]bool{}
	for _, m := range f.sent {
		if keys[m.Key] {
			t.Fatalf("event %s sent twice", m.Key)
		}
		keys[m.Key] = true
	}
	if len(keys) != 10 {
		t.Fatalf("sent %d of 10", len(keys))
	}
}

func TestBackoff(t *testing.T) {
	for n, want := range map[int]string{1: "1m0s", 2: "2m0s", 6: "32m0s", 7: "1h0m0s", 10: "1h0m0s"} {
		if got := Backoff(n).String(); got != want {
			t.Errorf("Backoff(%d) = %s, want %s", n, got, want)
		}
	}
}

// R-82: the payer's receipt goes to the address they gave, whatever the owner's setting, with what they paid, to whom,
// the transaction and the receipt PDF.
func TestDeliverSendsTheReceiptToThePayer(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	exec(t, pool, "UPDATE profiles SET email_notifications = false")
	exec(t, pool, "UPDATE invoices SET payer_email = 'payer@example.com' WHERE id = $1", id)
	hash := "0x" + strings.Repeat("cd", 32)
	exec(t, pool, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		VALUES (84532, 'evm', '0x00000000000000000000000000000000000000ee', $1, $2, 0, $2, 1, 1,
		    '0x4444444444444444444444444444444444444444', '0x3333333333333333333333333333333333333333', 5000000, 'confirmed')`,
		id, hash)
	// Later transfers the link must not pick: one after the checkout closed, and one not final yet.
	for i, d := range []struct {
		status string
		late   bool
	}{{"confirmed", true}, {"detected", false}} {
		at := "1"
		if d.late {
			at = "2000000001"
		}
		exec(t, pool, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			    block_hash, block_number, block_time, from_address, to_address, amount, status)
			VALUES (84532, 'evm', '0x00000000000000000000000000000000000000ee', $1, $2, 0, $2, $3, $4::bigint,
			    '0x4444444444444444444444444444444444444444', '0x3333333333333333333333333333333333333333', 1, $5)`,
			id, "0x"+strings.Repeat(fmt.Sprintf("%02x", 0xe0+i), 32), 10+i, at, d.status)
	}
	if err := pgx.BeginFunc(context.Background(), pool, func(tx pgx.Tx) error {
		return outbox.QueueReceipt(context.Background(), tx, id)
	}); err != nil {
		t.Fatal(err)
	}
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, web); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 1 {
		t.Fatalf("sent %d, want the receipt alone", len(f.sent))
	}
	m := f.sent[0]
	for _, want := range []string{"You paid 5.00 USDC on Base Sepolia to Mara Ilić for INV-0001.",
		"The name is what the invoice's creator gave; Forwend doesn't check it.",
		"Transaction: https://sepolia.basescan.org/tx/" + hash, "Receipt (PDF): " + web + "/api/v1/invoices/" + id + "/receipt.pdf"} {
		if !strings.Contains(m.Text, want) {
			t.Fatalf("receipt text %q lacks %q", m.Text, want)
		}
	}
	if m.To != "payer@example.com" || m.Subject != "Your receipt for INV-0001" {
		t.Fatalf("receipt %+v", m)
	}
}

// The idempotency key changes with the address: a receipt restarted for a changed address is a new request to
// Resend, not a replay it would refuse.
func TestKeyFollowsTheAddress(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	queue(t, pool, outbox.Paid, id, nil)
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, web); err != nil {
		t.Fatal(err)
	}
	exec(t, pool, "UPDATE users SET login_email = 'other@example.com'")
	exec(t, pool, "UPDATE outbox_events SET published_at = NULL")
	if err := Deliver(context.Background(), pool, f, web); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 2 || f.sent[0].Key == f.sent[1].Key {
		t.Fatalf("keys %v: want a new key for the new address", f.sent)
	}
}

// An invoice with billing details names its issuer, which Forwend shows as given, without the unchecked note.
func TestReceiptNamesTheIssuer(t *testing.T) {
	m := receipt("INV-0001", "5.00 USDC", "Base Sepolia", "Alice Design GmbH", "Mara", "", "pdf")
	if !strings.Contains(m.Text, "to Alice Design GmbH for INV-0001.") || strings.Contains(m.Text, "doesn't check") {
		t.Fatalf("receipt %q", m.Text)
	}
}
