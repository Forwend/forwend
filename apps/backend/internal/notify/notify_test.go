package notify

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/email"
	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/history/historytest"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const web = "https://app.example"

var site = Site{WebURL: web}

type fake struct {
	mu     sync.Mutex
	sent   []email.Message
	keys   []string // of every try, failed or not
	fail   bool
	refuse string
}

func (f *fake) Send(_ context.Context, m email.Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.keys = append(f.keys, m.Key)
	if f.fail {
		return errors.New("Resend answered 503")
	}
	if m.To == f.refuse {
		return fmt.Errorf("%w: Resend answered 422", email.ErrRefused)
	}
	f.sent = append(f.sent, m)
	return nil
}

// payToken is setup's invoice's pay link token (D-86).
var payToken = strings.Repeat("ef", 32)

// setup makes one user (login "" when the account has none), profile and 5 USDC invoice on Base Sepolia.
func setup(t *testing.T, login string) (*pgxpool.Pool, string) {
	t.Helper()
	ctx := context.Background()
	url := databasetest.Migrated(t, database.Migrate)
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	id := fmt.Sprintf("0x%x", address.InvoiceID([32]byte(common.FromHex(payToken)))) // as a real invoice's
	exec(t, pool, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (84532, 'evm', 'base-sepolia', true) ON CONFLICT (chain_id) DO UPDATE SET enabled = true),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (84532, 'evm', '0x00000000000000000000000000000000000000ee', 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id, login_email) VALUES ('did:privy:a', $2) RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id)
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash, sender_name,
		    pay_token)
		SELECT $1, id, 84532, 'evm', '0x00000000000000000000000000000000000000ee', 5000000, 2000000000, 2000086400,
		    '0x1111111111111111111111111111111111111111', 'evm_create2', '0x2222222222222222222222222222222222222222',
		    '0x3333333333333333333333333333333333333333', 'k', decode(repeat('00', 32), 'hex'), 'Mara Ilić', $3 FROM p`, id,
		login, payToken)
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

// R-80.
func TestDeliverSendsOneEmailPerEvent(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	queue(t, pool, outbox.Paid, id, nil)
	queue(t, pool, outbox.Settled, id, nil)
	queue(t, pool, outbox.Held, id, big.NewInt(1500000))
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if err := Deliver(context.Background(), pool, f, site); err != nil { // nothing left: nothing sent twice
		t.Fatal(err)
	}
	if len(f.sent) != 3 || count(t, pool, "published_at IS NULL") != 0 {
		t.Fatalf("sent %d, unpublished %d", len(f.sent), count(t, pool, "published_at IS NULL"))
	}
	for i, want := range []struct{ subject, text string }{
		{"INV-0001 paid: 5.00 USDC", "INV-0001 was paid\n5.00 USDC\n"},
		{"INV-0001: 5.00 USDC is in your wallet", "Money for INV-0001 is in your wallet\n5.00 USDC\n"},
		{"INV-0001: 1.50 USDC held for the payer", "INV-0001: money held for the payer\n1.50 USDC\n"},
	} {
		m := f.sent[i]
		if m.To != "owner@example.com" || m.Subject != want.subject || !strings.Contains(m.Text, want.text) ||
			!strings.Contains(m.Text, "Network: Base Sepolia") ||
			!strings.Contains(m.Text, web+"/app/invoices/"+id) || !strings.Contains(m.Text, web+"/app/notifications") ||
			!strings.HasPrefix(m.Key, fmt.Sprintf("forwend-%s-%d-", id, i+1)) {
			t.Fatalf("email %d: %+v", i, m)
		}
	}
	if !strings.Contains(f.sent[2].Text, "Forwend support handles any return to the payer") {
		t.Fatalf("held email doesn't say who handles the return: %s", f.sent[2].Text)
	}
}

func TestDeliverSendsCheckoutNotificationsWithoutInvoiceNumbers(t *testing.T) {
	pool, original := setup(t, "owner@example.com")
	id := "0x" + strings.Repeat("ac", 32)
	exec(t, pool, `INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		request_hash, pay_token, purpose, document_kind, payer_email)
		SELECT $1, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		recipient_address, receive_method, factory_address, '0x' || repeat('44', 20), 'checkout', request_hash,
		repeat('cd', 32), 'checkout', 'none', 'payer@example.com' FROM invoices WHERE id = $2`, id, original)
	queue(t, pool, outbox.Paid, id, nil)
	queue(t, pool, outbox.Receipt, id, nil)
	f := &fake{}
	if err := Deliver(t.Context(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 2 || count(t, pool, "published_at IS NULL") != 0 {
		t.Fatalf("sent %d, unpublished %d", len(f.sent), count(t, pool, "published_at IS NULL"))
	}
	for _, m := range f.sent {
		if strings.Contains(m.Text, "INV-") || !strings.Contains(m.Text, "Payment acacacacacac") {
			t.Fatalf("checkout email invented or omitted its reference: %+v", m)
		}
	}
	if !strings.Contains(f.sent[0].Text, web+"/app/payments/"+id) || f.sent[1].To != "payer@example.com" {
		t.Fatalf("owner or payer delivery: %+v", f.sent)
	}
}

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
			if err := Deliver(context.Background(), pool, f, site); err != nil {
				t.Fatal(err)
			}
			if len(f.sent) != 0 || count(t, pool, "published_at IS NOT NULL") != 1 {
				t.Fatalf("sent %d, published %d", len(f.sent), count(t, pool, "published_at IS NOT NULL"))
			}
		})
	}
}

func TestDeliverRetriesWithBackoffThenGivesUp(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	queue(t, pool, outbox.Paid, id, nil)
	f := &fake{fail: true}
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if count(t, pool, "attempts = 1 AND next_attempt_at > now() + interval '50 seconds' AND published_at IS NULL") != 1 {
		t.Fatal("after one failure: want attempts 1 and a wait of about a minute")
	}
	// A failure ends the round: of two events due at once, one is tried against a failing Resend, the other waits.
	queue(t, pool, outbox.Paid, id, nil)
	queue(t, pool, outbox.Paid, id, nil)
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if count(t, pool, "id > 1 AND attempts = 1") != 1 || count(t, pool, "id > 1 AND attempts = 0") != 1 {
		t.Fatal("a failed send did not end the round")
	}
	exec(t, pool, "DELETE FROM outbox_events WHERE id > 1")
	if err := Deliver(context.Background(), pool, f, site); err != nil { // not due yet: no second try now
		t.Fatal(err)
	}
	if count(t, pool, "attempts = 1") != 1 {
		t.Fatal("tried again before its backoff")
	}
	exec(t, pool, "UPDATE outbox_events SET attempts = $1, next_attempt_at = now()", MaxAttempts-1)
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if count(t, pool, "failed_at IS NOT NULL AND published_at IS NULL") != 1 {
		t.Fatal("not given up after MaxAttempts")
	}
	f.fail = false
	if err := Deliver(context.Background(), pool, f, site); err != nil || len(f.sent) != 0 {
		t.Fatalf("a given-up event was sent: %d (%v)", len(f.sent), err)
	}
}

// R-115: a payer address saved again and again can't hold up everyone's email.
func TestDeliverGoesOnPastARefusedEmail(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	exec(t, pool, "ALTER TABLE invoices DISABLE TRIGGER invoices_guard, DISABLE TRIGGER invoices_number")
	exec(t, pool, "UPDATE invoices SET payer_email = 'x@bad.example' WHERE id = $1", id)
	exec(t, pool, "ALTER TABLE invoices ENABLE TRIGGER invoices_guard, ENABLE TRIGGER invoices_number")
	f := &fake{refuse: "x@bad.example"}
	queue(t, pool, outbox.Receipt, id, nil)
	for round := range 3 {
		// The payer's PUT puts the receipt first in line again (invoice.SetPayerEmail).
		exec(t, pool, `UPDATE outbox_events SET attempts = 0, failed_at = NULL, next_attempt_at = now()
			WHERE kind = 'invoice.receipt' AND published_at IS NULL`)
		queue(t, pool, outbox.Paid, id, nil)
		if err := Deliver(context.Background(), pool, f, site); err != nil {
			t.Fatal(err)
		}
		if len(f.sent) != round+1 || count(t, pool, `kind = 'invoice.receipt' AND attempts = 1 AND failed_at IS NULL
			AND next_attempt_at > now() + interval '50 seconds'`) != 1 {
			t.Fatalf("round %d: sent %d, want the owner's email each round and the receipt waiting its backoff", round,
				len(f.sent))
		}
	}
}

func TestDeliverGoesOnPastAnEventItCannotRead(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	exec(t, pool, `INSERT INTO outbox_events (kind, invoice_id, payload) VALUES ('invoice.paid', $1, '{"option": "gone"}')`,
		id)
	queue(t, pool, outbox.Paid, id, nil)
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 1 || count(t, pool, `id = 1 AND attempts = 1 AND failed_at IS NULL
		AND next_attempt_at > now() + interval '50 seconds'`) != 1 {
		t.Fatalf("sent %d, want the next email sent and the unreadable event waiting its backoff", len(f.sent))
	}
}

// R-98.
func TestDeliverTellsTheOwnerARetainerMonthFailed(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	exec(t, pool, "UPDATE profiles SET email_notifications = false")
	exec(t, pool, `INSERT INTO outbox_events (kind, invoice_id, payload) VALUES ('retainer.failed', $1, '{"due": "2027-02-28"}')`,
		id)
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 1 {
		t.Fatalf("%d emails, want one", len(f.sent))
	}
	m := f.sent[0]
	if m.To != "owner@example.com" || m.Subject != "Repeating invoice not made: INV-0001" ||
		!strings.Contains(m.Text, "Due date: 28 Feb 2027") || !strings.Contains(m.Text, web+"/app/invoices/"+id) {
		t.Fatalf("email %+v", m)
	}
}

func TestRetryKeepsTheIdempotencyKey(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	queue(t, pool, outbox.Paid, id, nil)
	f := &fake{fail: true}
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	exec(t, pool, "UPDATE outbox_events SET next_attempt_at = now()")
	f.fail = false
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.keys) != 2 || len(f.sent) != 1 || f.keys[0] != f.keys[1] {
		t.Fatalf("keys of the failed try and the retry %v: want one key twice", f.keys)
	}
}

// Resend answers 409 to a key it saw with another body: an invoice edited between two tries gets a new key.
func TestRetryOfAChangedEmailTakesANewKey(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	exec(t, pool, "UPDATE invoices SET client_email = 'ap@client.example' WHERE id = $1", id)
	if err := pgx.BeginFunc(context.Background(), pool, func(tx pgx.Tx) error {
		return outbox.QueueSend(context.Background(), tx, id, "k1", history.Owner)
	}); err != nil {
		t.Fatal(err)
	}
	f := &fake{fail: true}
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	exec(t, pool, "ALTER TABLE invoices DISABLE TRIGGER invoices_guard")
	exec(t, pool, "UPDATE invoices SET due_date = '2099-12-31' WHERE id = $1", id)
	exec(t, pool, "ALTER TABLE invoices ENABLE TRIGGER invoices_guard")
	exec(t, pool, "UPDATE outbox_events SET next_attempt_at = now()")
	f.fail = false
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.keys) != 2 || len(f.sent) != 1 || f.keys[0] == f.keys[1] || !strings.Contains(f.sent[0].Text, "31 Dec 2099") {
		t.Fatalf("keys %v, sent %d: want a new key for the changed email", f.keys, len(f.sent))
	}
}

func TestDeliverClaimsEachEventOnce(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	for range 10 {
		queue(t, pool, outbox.Paid, id, nil)
	}
	f := &fake{}
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			if err := Deliver(context.Background(), pool, f, site); err != nil {
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

// R-82.
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
	// The ledger booked it to the creator; the link is a payment that paid the creator (R-121).
	book := func(hash, account string, amount int64) {
		t.Helper()
		exec(t, pool, `WITH x AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
			    SELECT $1, 'deposit', id FROM chain_transfers WHERE tx_hash = $2 RETURNING id)
			INSERT INTO ledger_entries (transaction_id, account, amount)
			SELECT id, 'receiver', $4::numeric FROM x UNION ALL SELECT id, $3, -$4::numeric FROM x`, id, hash, account, amount)
	}
	book(hash, "recipient_payable", 5000000)
	// Later transfers the link must not pick: one after the checkout closed, one not final yet, and one on time but
	// held for the payer because the invoice was already paid.
	for i, d := range []struct {
		status string
		late   bool
	}{{"confirmed", true}, {"detected", false}, {"confirmed", false}} {
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
	book("0x"+strings.Repeat("e2", 32), "payer_held", 1)
	if err := pgx.BeginFunc(context.Background(), pool, func(tx pgx.Tx) error {
		return outbox.QueueReceipt(context.Background(), tx, id)
	}); err != nil {
		t.Fatal(err)
	}
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 1 {
		t.Fatalf("sent %d, want the receipt alone", len(f.sent))
	}
	m := f.sent[0]
	for _, want := range []string{"Receipt for INV-0001\n5.00 USDC\n", "Your payment to Mara Ilić is complete.",
		unchecked, "Test mode: testnet tokens have no value.",
		"Transaction: https://sepolia.basescan.org/tx/" + hash, "Download receipt (PDF): " + web + "/api/v1/invoices/" + payToken + "/receipt.pdf"} {
		if !strings.Contains(m.Text, want) {
			t.Fatalf("receipt text %q lacks %q", m.Text, want)
		}
	}
	if m.To != "payer@example.com" || m.Subject != "Your receipt for INV-0001" {
		t.Fatalf("receipt %+v", m)
	}
}

func TestKeyFollowsTheAddress(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	queue(t, pool, outbox.Paid, id, nil)
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	exec(t, pool, "UPDATE users SET login_email = 'other@example.com'")
	exec(t, pool, "UPDATE outbox_events SET published_at = NULL")
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 2 || f.sent[0].Key == f.sent[1].Key {
		t.Fatalf("keys %v: want a new key for the new address", f.sent)
	}
}

func TestReceiptNamesTheIssuer(t *testing.T) {
	m, err := message(site, receipt("INV-0001", "5.00 USDC", "Base Sepolia", "Alice Design GmbH", "Mara", "", "pdf"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(m.Text, "Your payment to Alice Design GmbH is complete.") || strings.Contains(m.Text, unchecked) {
		t.Fatalf("receipt %q", m.Text)
	}
}

// R-84.
func TestDeliverSendsTheWelcome(t *testing.T) {
	pool, _ := setup(t, "owner@example.com")
	exec(t, pool, "UPDATE profiles SET email_notifications = false")
	var user string
	if err := pool.QueryRow(context.Background(), `INSERT INTO outbox_events (kind, user_id, payload)
		SELECT 'account.welcome', id, '{}' FROM users RETURNING user_id::text`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	f := &fake{}
	for range 2 {
		if err := Deliver(context.Background(), pool, f, site); err != nil {
			t.Fatal(err)
		}
	}
	if len(f.sent) != 1 {
		t.Fatalf("%d emails, want one welcome", len(f.sent))
	}
	m := f.sent[0]
	if m.To != "owner@example.com" || m.Subject != "Welcome to Forwend" || !strings.Contains(m.Text, web+"/app\n") ||
		!strings.HasPrefix(m.Key, "forwend-user-"+user+"-1-") {
		t.Fatalf("welcome %+v", m)
	}
}

// D-86: an invoice made before the pay token has no pay link, so nothing that would link it goes to the client or payer.
func TestDeliverSendsNoClientEmailWithoutAPayLink(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	exec(t, pool, "ALTER TABLE invoices DISABLE TRIGGER invoices_guard, DISABLE TRIGGER invoices_number")
	exec(t, pool, `UPDATE invoices SET pay_token = NULL, client_email = 'ap@client.example', payer_email = 'p@x.example',
		due_date = '2026-11-30' WHERE id = $1`, id)
	exec(t, pool, "ALTER TABLE invoices ENABLE TRIGGER invoices_guard, ENABLE TRIGGER invoices_number")
	exec(t, pool, `INSERT INTO invoice_reminders (invoice_id, enabled, stop_token) VALUES ($1, true, $2)`, id,
		strings.Repeat("cd", 32))
	if err := pgx.BeginFunc(context.Background(), pool, func(tx pgx.Tx) error {
		return outbox.QueueSend(context.Background(), tx, id, "k1", history.Owner)
	}); err != nil {
		t.Fatal(err)
	}
	queue(t, pool, outbox.Receipt, id, nil)
	exec(t, pool, `INSERT INTO outbox_events (kind, invoice_id, payload) VALUES ($1, $2, jsonb_build_object('option', $2::text,
		'step', 'after'))`, outbox.Reminder, id)
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	var waiting int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM outbox_events WHERE published_at IS NULL").
		Scan(&waiting); err != nil || len(f.sent) != 0 || waiting != 0 {
		t.Fatalf("sent %d, %d still waiting (%v); want none sent and none waiting", len(f.sent), waiting, err)
	}
}

// R-94: the owner's send goes to the client's email whatever the owner's setting, from the issuer, with replies to the
// issuer's billing email, the pay page and the PDF. A payer-chooses invoice is priced in USD on any network.
func TestDeliverSendsTheInvoiceToTheClient(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	exec(t, pool, "UPDATE profiles SET email_notifications = false")
	exec(t, pool, "ALTER TABLE invoices DISABLE TRIGGER invoices_guard, DISABLE TRIGGER invoices_number")
	exec(t, pool, `UPDATE invoices SET client_email = 'ap@client.example', issuer_name = 'Alice Design GmbH',
		issuer_email = 'billing@alice.example', due_date = '2026-11-30' WHERE id = $1`, id)
	exec(t, pool, "ALTER TABLE invoices ENABLE TRIGGER invoices_guard, ENABLE TRIGGER invoices_number")
	send := func(invoice, key string) {
		t.Helper()
		if err := pgx.BeginFunc(context.Background(), pool, func(tx pgx.Tx) error {
			return outbox.QueueSend(context.Background(), tx, invoice, key, history.Owner)
		}); err != nil {
			t.Fatal(err)
		}
	}
	send(id, "k1")
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 1 {
		t.Fatalf("sent %d, want the client's email alone", len(f.sent))
	}
	m := f.sent[0]
	if m.To != "ap@client.example" || m.ReplyTo != "billing@alice.example" || m.Subject != "Invoice INV-0001 from Alice Design GmbH" ||
		!strings.HasPrefix(m.Key, "forwend-"+id+"-1-") {
		t.Fatalf("email %+v", m)
	}
	for _, want := range []string{"Invoice INV-0001 from Alice Design GmbH\n5.00 USDC\n", "Due date: 30 Nov 2026",
		"Network: Base Sepolia", "Download the invoice (PDF): " + web + "/api/v1/invoices/" + payToken + "/invoice.pdf",
		"View and pay: " + web + "/pay/" + payToken, "Reply to this email to reach them.",
		"Test mode: testnet tokens have no value."} {
		if !strings.Contains(m.Text, want) {
			t.Fatalf("text %q lacks %q", m.Text, want)
		}
	}
	if strings.Contains(m.Text, "/app/notifications") {
		t.Fatal("the client's email links the owner's settings")
	}

	// A second option: the client chooses, so the email names no token or network.
	exec(t, pool, `INSERT INTO invoices (id, main_id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT $2, id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, '0x5555555555555555555555555555555555555555', idempotency_key,
		    request_hash FROM invoices WHERE id = $1`, id, "0x"+strings.Repeat("cd", 32))
	send(id, "k2")
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 2 || !strings.Contains(f.sent[1].Text, "\n5.00 USD\n") ||
		!strings.Contains(f.sent[1].Text, "Network: You choose on the payment page") {
		t.Fatalf("payer-chooses email %+v", f.sent[len(f.sent)-1])
	}

	// A live invoice's email says nothing of test mode (R-143).
	exec(t, pool, "UPDATE chains SET livemode = true WHERE chain_id = (SELECT chain_id FROM invoices WHERE id = $1)", id)
	send(id, "k3")
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 3 || strings.Contains(f.sent[2].Text, "Test mode") {
		t.Fatalf("live email %+v", f.sent[len(f.sent)-1])
	}
}

// R-96.
func TestDeliverSendsTheReminderToTheClient(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	exec(t, pool, "ALTER TABLE invoices DISABLE TRIGGER invoices_guard, DISABLE TRIGGER invoices_number")
	exec(t, pool, `UPDATE invoices SET client_email = 'ap@client.example', issuer_name = 'Alice Design GmbH',
		issuer_email = 'billing@alice.example', due_date = '2026-11-30' WHERE id = $1`, id)
	exec(t, pool, "ALTER TABLE invoices ENABLE TRIGGER invoices_guard, ENABLE TRIGGER invoices_number")
	token := strings.Repeat("cd", 32)
	exec(t, pool, "INSERT INTO invoice_reminders (invoice_id, enabled, stop_token) VALUES ($1, true, $2)", id, token)
	remind := func(step string) {
		t.Helper()
		exec(t, pool, `INSERT INTO outbox_events (kind, invoice_id, payload) VALUES ('invoice.reminder', $1,
			jsonb_build_object('option', $1::text, 'step', $2::text))`, id, step)
	}
	f := &fake{}
	deliver := func() {
		t.Helper()
		if err := Deliver(context.Background(), pool, f, site); err != nil {
			t.Fatal(err)
		}
	}
	remind("after")
	deliver()
	if len(f.sent) != 1 {
		t.Fatalf("sent %d, want the reminder", len(f.sent))
	}
	m := f.sent[0]
	if m.To != "ap@client.example" || m.ReplyTo != "billing@alice.example" ||
		m.Subject != "Reminder: INV-0001 from Alice Design GmbH is overdue" ||
		m.Unsubscribe != web+"/api/v1/reminders/"+token+"/stop" {
		t.Fatalf("reminder %+v", m)
	}
	for _, want := range []string{"INV-0001 is overdue\n5.00 USDC\n", "That’s what’s left to pay to Alice Design GmbH.",
		"Due date: 30 Nov 2026", "Download the invoice (PDF): " + web + "/api/v1/invoices/" + payToken + "/invoice.pdf",
		"View and pay: " + web + "/pay/" + payToken, "Stop reminders: " + web + "/reminders/" + token} {
		if !strings.Contains(m.Text, want) {
			t.Fatalf("text %q lacks %q", m.Text, want)
		}
	}

	// Stopped after it was queued, or paid: nothing goes, and nothing waits.
	remind("due")
	exec(t, pool, "UPDATE invoice_reminders SET stopped_at = now()")
	deliver()
	exec(t, pool, "UPDATE invoice_reminders SET stopped_at = NULL")
	exec(t, pool, "UPDATE invoices SET payment_status = 'paid' WHERE id = $1", id)
	remind("before")
	deliver()
	if len(f.sent) != 1 || count(t, pool, "published_at IS NULL") != 0 {
		t.Fatalf("sent %d, unpublished %d: want nothing more sent and nothing waiting", len(f.sent),
			count(t, pool, "published_at IS NULL"))
	}
}

// R-107.
func TestDeliverSendsTheChangeToTheClient(t *testing.T) {
	pool, _ := setup(t, "owner@example.com")
	exec(t, pool, "UPDATE profiles SET email_notifications = false")
	job, token := "6f9619ff-8b86-4011-b42d-00c04fc964ff", strings.Repeat("cd", 32)
	exec(t, pool, `INSERT INTO jobs (id, profile_id, token, idempotency_key, request_hash, title, client_name, client_email,
		    issuer_name, issuer_address, issuer_country, issuer_email, accepted_name, accepted_email, accepted_at)
		SELECT $1, id, $2, 'k', decode(repeat('00', 32), 'hex'), 'Logo design', 'Bob Ltd', 'ap@bob.example',
		    'Alice Design GmbH', 'Hauptstr. 1', 'DE', 'billing@alice.example', 'Jane Doe', 'jane@bob.example', now()
		FROM profiles`, job, token)
	exec(t, pool, `INSERT INTO job_payments (job_id, position, title, amount_cents, due_days, on_accept)
		VALUES ($1, 1, 'Logo', 100000, 14, false)`, job)
	exec(t, pool, `INSERT INTO job_payments (job_id, position, title, amount_cents, due_days, on_accept, proposed_at,
		    change_key, change_hash) VALUES ($1, 2, 'Extra page', 15000, 7, false, now(), 'c1', decode(repeat('00', 32), 'hex'))`, job)
	f := &fake{}
	change := func(key string) {
		t.Helper()
		if err := pgx.BeginFunc(context.Background(), pool, func(tx pgx.Tx) error {
			return outbox.QueueChange(context.Background(), tx, job, key)
		}); err != nil {
			t.Fatal(err)
		}
		if err := Deliver(context.Background(), pool, f, site); err != nil {
			t.Fatal(err)
		}
	}
	change("c1")
	if len(f.sent) != 1 {
		t.Fatalf("sent %d, want the client's email alone", len(f.sent))
	}
	m := f.sent[0]
	if m.To != "jane@bob.example" || m.ReplyTo != "billing@alice.example" ||
		m.Subject != "Alice Design GmbH proposed a change to Logo design" || !strings.HasPrefix(m.Key, "forwend-job-"+job+"-") {
		t.Fatalf("email %+v", m)
	}
	for _, want := range []string{"A change to Logo design\n150.00 USD\n", "Alice Design GmbH proposed “Extra page”.",
		"due 7 days after.", "Review the change: " + web + "/w/" + token, "Reply to this email to reach them."} {
		if !strings.Contains(m.Text, want) {
			t.Fatalf("text %q lacks %q", m.Text, want)
		}
	}
	if strings.Contains(m.Text, "/app/notifications") {
		t.Fatal("the client's email links the owner's settings")
	}
	change("withdrawn")
	exec(t, pool, `UPDATE job_payments SET accepted_name = 'Jane Doe', accepted_email = 'jane@bob.example',
		accepted_at = now() WHERE job_id = $1 AND position = 2`, job)
	change("c1")
	if len(f.sent) != 1 || count(t, pool, "kind = 'job.change' AND published_at IS NOT NULL") != 3 {
		t.Fatalf("sent %d for a withdrawn or accepted change", len(f.sent)-1)
	}
}

// R-107: the change email says when its invoice is due as the job page does.
func TestChangeEmailSaysWhenItIsDue(t *testing.T) {
	for days, want := range map[int]string{0: "due the day it is invoiced.", 1: "due 1 day after.", 7: "due 7 days after."} {
		if lead := change("Alice", "Logo", "Extra", "1.00 USD", days, "", "link").Lead[1]; !strings.HasSuffix(lead, want) {
			t.Fatalf("%d days: %q, want it to end %q", days, lead, want)
		}
	}
}

// R-126: By is who asked; the owner's own emails are not the client's.
func TestDeliverRecordsClientEmailsInHistory(t *testing.T) {
	pool, id := setup(t, "owner@example.com")
	exec(t, pool, "ALTER TABLE invoices DISABLE TRIGGER invoices_guard, DISABLE TRIGGER invoices_number")
	exec(t, pool, "UPDATE invoices SET client_email = 'ap@client.example', due_date = '2026-11-30' WHERE id = $1", id)
	exec(t, pool, "ALTER TABLE invoices ENABLE TRIGGER invoices_guard, ENABLE TRIGGER invoices_number")
	exec(t, pool, "INSERT INTO invoice_reminders (invoice_id, enabled, stop_token) VALUES ($1, true, $2)", id,
		strings.Repeat("cd", 32))
	if err := pgx.BeginFunc(context.Background(), pool, func(tx pgx.Tx) error {
		return outbox.QueueSend(context.Background(), tx, id, "k1", history.Owner)
	}); err != nil {
		t.Fatal(err)
	}
	remind := func(step string) {
		exec(t, pool, `INSERT INTO outbox_events (kind, invoice_id, payload) VALUES ('invoice.reminder', $1,
			jsonb_build_object('option', $1::text, 'step', $2::text))`, id, step)
	}
	remind("due")
	queue(t, pool, outbox.Paid, id, nil)
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, site); err != nil || len(f.sent) != 3 {
		t.Fatalf("sent %d (%v), want 3", len(f.sent), err)
	}
	sent := []string{"email.invoice_sent by owner", `email.reminder_sent by system {"step": "due"}`}
	if got := historytest.Events(t, pool, id); !slices.Equal(got, sent) {
		t.Fatalf("history %q, want %q", got, sent)
	}
	// A failure to try again writes nothing; giving up writes the failed row.
	remind("after")
	f.fail = true
	for _, attempts := range []int{0, MaxAttempts - 1} {
		exec(t, pool, "UPDATE outbox_events SET attempts = $1, next_attempt_at = now() WHERE published_at IS NULL",
			attempts)
		if err := Deliver(context.Background(), pool, f, site); err != nil {
			t.Fatal(err)
		}
		want := sent
		if attempts > 0 {
			want = append(slices.Clone(sent), `email.reminder_failed by system {"step": "after"}`)
		}
		if got := historytest.Events(t, pool, id); !slices.Equal(got, want) {
			t.Fatalf("after a failure with %d attempts before: history %q, want %q", attempts, got, want)
		}
	}
}

// R-139: the invite goes to the address invited with its link; then only the token's hash is left. A revoked invite
// sends nothing.
func TestDeliverSendsTheInviteThenDropsItsToken(t *testing.T) {
	pool, _ := setup(t, "owner@example.com")
	ctx := context.Background()
	exec(t, pool, "UPDATE profiles SET kind = 'merchant', name = 'Alice Shop'")
	invite := func(address, token string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `INSERT INTO profile_invites (profile_id, email, role, token_hash, invited_by)
			SELECT p.id, $1, 'developer', sha256(convert_to($2, 'UTF8')), p.user_id FROM profiles p RETURNING id::text`,
			address, token).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error { return outbox.QueueInvite(ctx, tx, id, token) }); err != nil {
			t.Fatal(err)
		}
		return id
	}
	sent, revoked, failing := strings.Repeat("ab", 32), strings.Repeat("cd", 32), strings.Repeat("ef", 32)
	// An invite whose email is given up drops its token too.
	invite("bounce@example.com", failing)
	exec(t, pool, "UPDATE outbox_events SET attempts = $1", MaxAttempts-1)
	if err := Deliver(ctx, pool, &fake{fail: true}, site); err != nil {
		t.Fatal(err)
	}
	if n := count(t, pool, "kind = 'team.invite' AND failed_at IS NOT NULL AND NOT payload ? 'token'"); n != 1 {
		t.Fatalf("%d given-up invites without their token, want 1", n)
	}
	id := invite("dev@example.com", sent)
	exec(t, pool, "UPDATE profile_invites SET revoked_at = now() WHERE id = $1", invite("gone@example.com", revoked))
	f := &fake{}
	if err := Deliver(ctx, pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 1 {
		t.Fatalf("%d emails, want the open invite's alone", len(f.sent))
	}
	m := f.sent[0]
	if m.To != "dev@example.com" || m.Subject != "Join Alice Shop on Forwend" || m.ReplyTo != "owner@example.com" ||
		!strings.Contains(m.Text, web+"/invite/"+sent) || !strings.HasPrefix(m.Key, "forwend-invite-"+id+"-") {
		t.Fatalf("invite %+v", m)
	}
	if n := count(t, pool, "kind = 'team.invite' AND (payload ? 'token' OR (published_at IS NULL AND failed_at IS NULL))"); n != 0 {
		t.Fatalf("%d invite rows still hold a token or wait", n)
	}
}

// R-148: whatever the profile's email setting, and naming only the endpoint's host.
func TestDeliverSendsTheTurnedOffEndpoint(t *testing.T) {
	pool, _ := setup(t, "owner@example.com")
	exec(t, pool, "UPDATE profiles SET email_notifications = false")
	var endpoint string
	if err := pool.QueryRow(context.Background(), `WITH w AS (INSERT INTO webhook_endpoints (id, profile_id, url, events,
		    enabled) SELECT gen_random_uuid(), id, 'https://shop.example.com/hooks?token=receiver-secret',
		    '{invoice.paid}', false FROM profiles RETURNING id)
		INSERT INTO outbox_events (kind, endpoint_id, payload) SELECT 'webhook.disabled', id, '{"reason": "gone"}' FROM w
		RETURNING endpoint_id::text`).Scan(&endpoint); err != nil {
		t.Fatal(err)
	}
	f := &fake{}
	if err := Deliver(context.Background(), pool, f, site); err != nil {
		t.Fatal(err)
	}
	if len(f.sent) != 1 {
		t.Fatalf("%d emails, want one", len(f.sent))
	}
	m := f.sent[0]
	if m.To != "owner@example.com" || m.Subject != "Webhook endpoint turned off: shop.example.com" ||
		!strings.Contains(m.Text, "shop.example.com answered 410 Gone") || !strings.Contains(m.Text, web+"/app/developers") ||
		strings.Contains(m.Text+m.HTML, "receiver-secret") || !strings.HasPrefix(m.Key, "forwend-endpoint-"+endpoint+"-") {
		t.Fatalf("email %+v", m)
	}
}

// during runs fn inside Send, while the worker holds the event's row.
type during func()

func (fn during) Send(context.Context, email.Message) error { fn(); return nil }

// The receipt goes out while the payer changes the address: the change waits for the send and sees it sent, and the
// worker's history row doesn't deadlock with the change's lock on the invoice.
func TestPayerEmailChangeWaitsForTheReceiptBeingSent(t *testing.T) {
	ctx := context.Background()
	pool, id := setup(t, "owner@example.com")
	exec(t, pool, "UPDATE invoices SET payer_email = 'payer@example.com' WHERE id = $1", id)
	queue(t, pool, outbox.Receipt, id, nil)
	changed := make(chan error, 1)
	send := during(func() {
		go func() {
			_, err := invoice.NewService(pool).SetPayerEmail(ctx, payToken, "new@example.com",
				func() time.Duration { return 0 })
			changed <- err
		}()
		for waiting, start := 0, time.Now(); waiting == 0 && time.Since(start) < 10*time.Second; {
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'
				AND datname = current_database()`).Scan(&waiting); err != nil {
				t.Error(err)
				return
			}
		}
	})
	if err := Deliver(ctx, pool, send, site); err != nil {
		t.Fatal(err)
	}
	if err := <-changed; !errors.Is(err, invoice.ErrReceiptSent) {
		t.Fatalf("change: %v, want ErrReceiptSent", err)
	}
	if count(t, pool, "kind = 'invoice.receipt' AND published_at IS NOT NULL") != 1 {
		t.Fatalf("the receipt is not marked sent")
	}
}

// R-137: the code is in the subject and both parts, and the email names no link but the app.
func TestTheCodeEmailCarriesItsCode(t *testing.T) {
	m, err := CodeMessage(Site{WebURL: "https://forwend.test"}, "042517", 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(m.Text, "It works for 10 minutes.") {
		t.Errorf("text %q doesn't say how long the code works", m.Text)
	}
	if m.Subject != "Your Forwend code: 042517" || !strings.Contains(m.Text, "042517") || !strings.Contains(m.HTML, "042517") {
		t.Errorf("subject %q, text has code %v, html has code %v", m.Subject, strings.Contains(m.Text, "042517"),
			strings.Contains(m.HTML, "042517"))
	}
}

// R-239: the owner's paid email and the payer's receipt name what was sent through NEAR Intents.
func TestPaidEmailsNameWhatWasPaidWith(t *testing.T) {
	// A quote 1Click refunded didn't pay the invoice, even when its deposit was seen.
	for status, named := range map[string]bool{"SUCCESS": true, "REFUNDED": false} {
		t.Run(status, func(t *testing.T) {
			pool, id := setup(t, "owner@example.com")
			exec(t, pool, "UPDATE invoices SET payer_email = 'payer@example.com' WHERE id = $1", id)
			exec(t, pool, `INSERT INTO crosschain_quotes (invoice_id, option_id, origin_asset, refund_to, deposit_address,
				    amount_in, min_amount_in, amount_out, time_estimate, shown_until, deadline, signed, status,
				    origin_blockchain, origin_symbol, origin_decimals, deposited_amount, deposit_seen_at, converted_at)
				VALUES ($1, $1, 'nep141:tron-usdt', 'T1', 'T2', 5060000, 5010000, 5000000, 27, now(), now(), '{}', $2,
				    'tron', 'USDT', 6, 5060000, now(), now())`, id, status)
			if err := pgx.BeginFunc(context.Background(), pool, func(tx pgx.Tx) error {
				if err := outbox.Queue(context.Background(), tx, outbox.Paid, id, nil); err != nil {
					return err
				}
				return outbox.QueueReceipt(context.Background(), tx, id)
			}); err != nil {
				t.Fatal(err)
			}
			f := &fake{}
			if err := Deliver(context.Background(), pool, f, site); err != nil {
				t.Fatal(err)
			}
			if len(f.sent) != 2 {
				t.Fatalf("sent %d, want the paid email and the receipt", len(f.sent))
			}
			for _, m := range f.sent {
				if got := strings.Contains(m.Text, "Paid with: 5.06 USDT on Tron through NEAR Intents"); got != named {
					t.Fatalf("%s names what was paid with: %v, want %v:\n%s", m.Subject, got, named, m.Text)
				}
			}
		})
	}
}
