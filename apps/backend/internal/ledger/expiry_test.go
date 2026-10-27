package ledger

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/history/historytest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// sim: transfers are written directly and the test sets the second RPC's answers.
type sim struct {
	t        *testing.T
	pool     *pgxpool.Pool
	service  *Service
	answer   map[string]*big.Int // second RPC balance per receive address
	down     map[string]bool     // second RPC errors for these addresses
	behind   map[string]bool     // second RPC answers 0 from a block before the finalized one
	deployed map[string]uint64   // factory.deployedAt per receive address
	calls    []string            // second RPC balance calls, by receive address
	n        int
}

const simToken, simExpires = "0x00000000000000000000000000000000000000ee", 1000

func newSim(t *testing.T) *sim {
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
	_, err = pool.Exec(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (1, 'evm', 'sim', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (1, 'evm', $1, 'USDC', 6, true)),
		     cur AS (INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES (1, 100, 100)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:sim') RETURNING id)
		INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u`, simToken)
	if err != nil {
		t.Fatal(err)
	}
	s := &sim{t: t, pool: pool, answer: map[string]*big.Int{}, down: map[string]bool{}, behind: map[string]bool{},
		deployed: map[string]uint64{}}
	s.service = NewService(pool, func(_ context.Context, _ uint64, _, holder string) (*big.Int, uint64, error) {
		s.calls = append(s.calls, holder)
		switch {
		case s.down[holder]:
			return nil, 0, errors.New("second RPC down")
		case s.behind[holder]:
			return new(big.Int), 99, nil
		}
		return new(big.Int).Set(s.answer[holder]), 1000, nil
	}, func(_ context.Context, _ uint64, _, receiver string) (uint64, error) {
		return s.deployed[receiver], nil
	})
	return s
}

func (s *sim) invoice() (id, receive string) {
	s.t.Helper()
	s.n++
	id, receive = fmt.Sprintf("0x%064x", s.n), fmt.Sprintf("0x%040x", 0x1000+s.n)
	s.answer[receive] = new(big.Int)
	_, err := s.pool.Exec(context.Background(), `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		SELECT $1, id, 1, 'evm', $2, 5000000, $3::bigint, $3::bigint + 86400, '0x1111111111111111111111111111111111111111',
		    'evm_create2', '0x2222222222222222222222222222222222222222', $4, $1, decode(repeat('00', 32), 'hex') FROM profiles`,
		id, simToken, simExpires, receive)
	if err != nil {
		s.t.Fatal(err)
	}
	return id, receive
}

// transfer also adds the amount to the second RPC's answer.
func (s *sim) transfer(id, receive string, amount, blockTime int64, status string) int64 {
	s.t.Helper()
	s.n++
	var tid int64
	err := s.pool.QueryRow(context.Background(), `
		INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index, block_hash,
		    block_number, block_time, from_address, to_address, amount, status)
		VALUES (1, 'evm', $1, $2, $3, 0, $3, $4, $5, '0x00000000000000000000000000000000000000ff', $6, $7, $8)
		RETURNING id`, simToken, id, fmt.Sprintf("0x%064x", s.n), s.n, blockTime, receive, amount, status).Scan(&tid)
	if err != nil {
		s.t.Fatal(err)
	}
	s.answer[receive].Add(s.answer[receive], big.NewInt(amount))
	return tid
}

func (s *sim) exec(sql string, args ...any) {
	s.t.Helper()
	if _, err := s.pool.Exec(context.Background(), sql, args...); err != nil {
		s.t.Fatal(err)
	}
}

func (s *sim) finalizedAt(time int64) {
	s.t.Helper()
	s.exec("UPDATE chain_cursors SET last_finalized_time = $1 WHERE chain_id = 1", time)
}

func (s *sim) process(id string) {
	s.t.Helper()
	if err := s.service.Process(context.Background(), id); err != nil {
		s.t.Fatal(err)
	}
}

func (s *sim) payment(id string) (payment, refund string) {
	s.t.Helper()
	if err := s.pool.QueryRow(context.Background(), "SELECT payment_status, refund_status FROM invoices WHERE id = $1",
		id).Scan(&payment, &refund); err != nil {
		s.t.Fatal(err)
	}
	return payment, refund
}

func TestLaggingSecondRPCNeverExpiresAPaidInvoice(t *testing.T) {
	s := newSim(t)
	id, receive := s.invoice()
	s.transfer(id, receive, 5000000, simExpires-10, "confirmed")
	s.finalizedAt(simExpires + 1)
	s.answer[receive] = new(big.Int) // lags: reports nothing yet
	s.process(id)
	if payment, _ := s.payment(id); payment != Detected {
		t.Fatalf("while the second RPC lags: %s, want detected (not final, not a partial payment)", payment)
	}
	s.answer[receive] = big.NewInt(5000000)
	s.process(id)
	if payment, refund := s.payment(id); payment != Paid || refund != "none" {
		t.Fatalf("once it agrees: %s/%s, want paid/none", payment, refund)
	}
}

func TestPendingOnTimeDepositDelaysExpiry(t *testing.T) {
	s := newSim(t)
	id, receive := s.invoice()
	tid := s.transfer(id, receive, 5000000, simExpires-10, "detected")
	s.finalizedAt(simExpires + 1)
	s.process(id)
	if payment, _ := s.payment(id); payment != Detected {
		t.Fatalf("with an on-time deposit pending: %s, want detected", payment)
	}
	s.exec("UPDATE chain_transfers SET status = 'confirmed' WHERE id = $1", tid)
	s.process(id)
	if payment, _ := s.payment(id); payment != Paid {
		t.Fatalf("once it is final: %s, want paid", payment)
	}
}

func TestUnexplainedBalanceDelaysExpiry(t *testing.T) {
	s := newSim(t)
	id, receive := s.invoice()
	s.answer[receive] = big.NewInt(5000000) // on chain, but no transfer row
	s.finalizedAt(simExpires + 1)
	s.process(id)
	if payment, _ := s.payment(id); payment != Open {
		t.Fatalf("with an unexplained balance: %s, want open", payment)
	}
	s.answer[receive] = new(big.Int)
	s.exec("UPDATE invoice_balance_alerts SET next_check_at = now()") // its next check is due (R-120)
	s.process(id)
	if payment, _ := s.payment(id); payment != Expired {
		t.Fatalf("once the balance matches the ledger: %s, want expired", payment)
	}
}

// R-120: stuck invoices can't use up a chain's round, and an honest invoice in the same round is still paid.
func TestUnexplainedBalanceWaitsLongerEachTime(t *testing.T) {
	s := newSim(t)
	var stuck []string
	for range 20 {
		id, receive := s.invoice()
		s.answer[receive] = big.NewInt(1)
		stuck = append(stuck, id)
	}
	honest, receive := s.invoice()
	s.transfer(honest, receive, 5000000, simExpires-10, "confirmed")
	s.finalizedAt(simExpires + 1)
	round := func() int {
		s.t.Helper()
		before := len(s.calls)
		if err := s.service.processChain(context.Background(), 1, false); err != nil {
			t.Fatal(err)
		}
		return len(s.calls) - before
	}
	if calls := round(); calls != 21 || s.calls[0] != receive {
		t.Fatalf("first round: %d balance calls, the first for %s; want 21, the honest invoice's first", calls,
			s.calls[0])
	}
	if payment, _ := s.payment(honest); payment != Paid {
		t.Fatalf("the honest invoice: %s, want paid", payment)
	}
	if calls := round(); calls != 0 {
		t.Fatalf("second round: %d balance calls, want none while the stuck invoices wait", calls)
	}
	wait := func() (n int, left time.Duration) {
		t.Helper()
		if err := s.pool.QueryRow(context.Background(), `SELECT alerts, next_check_at - now() FROM invoice_balance_alerts
			WHERE invoice_id = $1`, stuck[0]).Scan(&n, &left); err != nil {
			t.Fatal(err)
		}
		return n, left
	}
	if n, left := wait(); n != 1 || left < 50*time.Second || left > time.Minute {
		t.Fatalf("after one alert: %d, %v left; want 1 and about a minute", n, left)
	}
	s.exec("UPDATE invoice_balance_alerts SET next_check_at = now()")
	if calls := round(); calls != 20 {
		t.Fatalf("once the wait ended: %d balance calls, want 20", calls)
	}
	if n, left := wait(); n != 2 || left < 110*time.Second || left > 2*time.Minute {
		t.Fatalf("after two alerts: %d, %v left; want 2 and about two minutes", n, left)
	}
	// Weeks later the wait stays a day: the doubling stops before it overflows.
	s.exec("UPDATE invoice_balance_alerts SET alerts = 100, next_check_at = now()")
	round()
	if n, left := wait(); n != 101 || left < 23*time.Hour || left > 24*time.Hour {
		t.Fatalf("after 101 alerts: %d, %v left; want a day", n, left)
	}
}

// A missed on-time log and a second RPC behind the finalized block both read 0: that must not expire the invoice.
func TestSecondRPCBehindFinalizedNeverDecides(t *testing.T) {
	s := newSim(t)
	id, receive := s.invoice()
	s.answer[receive] = big.NewInt(5000000) // paid on time, but the watcher missed the log
	s.behind[receive] = true
	s.finalizedAt(simExpires + 1)
	s.process(id)
	if payment, _ := s.payment(id); payment != Open {
		t.Fatalf("with the second RPC behind: %s, want open", payment)
	}
	s.behind[receive] = false
	s.process(id)
	if payment, _ := s.payment(id); payment != Open {
		t.Fatalf("once it catches up, the unexplained balance still blocks expiry: %s", payment)
	}
	s.transfer(id, receive, 5000000, simExpires-10, "confirmed") // the watcher finds the log
	s.answer[receive] = big.NewInt(5000000)                      // transfer() added it again; the chain holds 5
	s.process(id)
	if payment, _ := s.payment(id); payment != Paid {
		t.Fatalf("after the watcher books it: %s, want paid", payment)
	}
}

func TestProcessChainContinuesAfterAnError(t *testing.T) {
	s := newSim(t)
	broken, brokenReceive := s.invoice()
	ok, okReceive := s.invoice()
	s.transfer(broken, brokenReceive, 5000000, simExpires-10, "confirmed")
	s.transfer(ok, okReceive, 5000000, simExpires-10, "confirmed")
	s.down[brokenReceive] = true
	if err := s.service.processChain(context.Background(), 1, false); err == nil {
		t.Fatal("ProcessChain hid the failing balance call")
	}
	if payment, _ := s.payment(ok); payment != Paid {
		t.Fatalf("the other invoice: %s, want paid", payment)
	}
}

func TestInvoiceStartsOpen(t *testing.T) {
	s := newSim(t)
	_, err := s.pool.Exec(context.Background(), `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash,
		    payment_status)
		SELECT '0x' || repeat('09', 32), id, 1, 'evm', $1, 5, 1000, 87400, '0x1111111111111111111111111111111111111111',
		    'evm_create2', '0x2222222222222222222222222222222222222222', '0x' || repeat('09', 20), 'k9',
		    decode(repeat('00', 32), 'hex'), 'paid' FROM profiles`, simToken)
	if err == nil {
		t.Fatal("an invoice was created as paid")
	}
}

// R-79, D-26: even the whole amount on time is held and never settled.
func TestCanceledInvoiceHoldsEveryDeposit(t *testing.T) {
	s := newSim(t)
	id, receive := s.invoice()
	s.exec(`UPDATE invoices SET payment_status = 'canceled', canceled_at = now() WHERE id = $1`, id)
	s.transfer(id, receive, 5000000, simExpires-10, "confirmed")
	s.answer[receive] = big.NewInt(5000000)
	s.process(id)
	if payment, refund := s.payment(id); payment != Canceled || refund != "held" {
		t.Fatalf("after a full payment: %s/%s, want canceled/held", payment, refund)
	}
	var held, settles int64
	if err := s.pool.QueryRow(context.Background(), `
		SELECT -coalesce(sum(e.amount), 0)::bigint FROM ledger_entries e
		    JOIN ledger_transactions x ON x.id = e.transaction_id WHERE x.invoice_id = $1 AND e.account = 'payer_held'`,
		id).Scan(&held); err != nil || held != 5000000 {
		t.Fatalf("held %d (%v), want 5000000", held, err)
	}
	if err := s.pool.QueryRow(context.Background(), "SELECT count(*) FROM settlement_intents WHERE invoice_id = $1",
		id).Scan(&settles); err != nil || settles != 0 {
		t.Fatalf("%d settlement intents (%v), want none", settles, err)
	}
	history := []string{`invoice.held by system {"amount": "5000000", "reason": "canceled"}`}
	if got := historytest.Events(t, s.pool, id); !reflect.DeepEqual(got, history) {
		t.Fatalf("history\n got %q\nwant %q", got, history)
	}
}

// R-80: each event once, from the transaction that made it; held carries the amount newly held.
func TestOutboxEventsFollowTheLedger(t *testing.T) {
	s := newSim(t)
	events := func(id string) []string {
		t.Helper()
		rows, err := s.pool.Query(context.Background(), `SELECT kind || ' ' || coalesce(payload->>'amount', '') FROM outbox_events
			WHERE invoice_id = $1 ORDER BY id`, id)
		if err != nil {
			t.Fatal(err)
		}
		got, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	paid, receive := s.invoice()
	s.transfer(paid, receive, 5000000, simExpires-10, "confirmed")
	s.answer[receive] = big.NewInt(5000000)
	s.process(paid)
	s.process(paid)
	// A late deposit after it was paid is held, and said once.
	s.transfer(paid, receive, 700000, simExpires+10, "confirmed")
	s.answer[receive] = big.NewInt(5700000)
	s.process(paid)
	if got := strings.Join(events(paid), ","); got != "invoice.paid ,invoice.held 700000" {
		t.Fatalf("paid invoice events %q", got)
	}

	partial, receive := s.invoice()
	s.transfer(partial, receive, 2000000, simExpires-10, "confirmed")
	s.answer[receive] = big.NewInt(2000000)
	s.process(partial)
	s.finalizedAt(simExpires + 1)
	s.process(partial)
	s.process(partial)
	if got := strings.Join(events(partial), ","); got != "invoice.held 2000000" {
		t.Fatalf("expired partial events %q", got)
	}
}

// R-82.
func TestPaidQueuesTheReceiptWhenAsked(t *testing.T) {
	s := newSim(t)
	id, receive := s.invoice()
	s.exec(`UPDATE invoices SET payer_email = 'payer@example.com' WHERE id = $1`, id)
	s.transfer(id, receive, 5000000, simExpires-10, "confirmed")
	s.answer[receive] = big.NewInt(5000000)
	s.process(id)
	s.process(id)
	var kinds string
	if err := s.pool.QueryRow(context.Background(), `SELECT string_agg(kind, ',' ORDER BY id) FROM outbox_events
		WHERE invoice_id = $1`, id).Scan(&kinds); err != nil || kinds != "invoice.paid,invoice.receipt" {
		t.Fatalf("events %q (%v), want invoice.paid,invoice.receipt", kinds, err)
	}
}
