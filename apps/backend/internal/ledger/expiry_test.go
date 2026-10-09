package ledger

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5/pgxpool"
)

// sim is a database with one simulated chain: transfers are written directly and the second RPC's answers are set
// by the test.
type sim struct {
	t       *testing.T
	pool    *pgxpool.Pool
	service *Service
	answer  map[string]*big.Int // second RPC balance per receive address
	down    map[string]bool     // second RPC errors for these addresses
	n       int
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
		     cur AS (INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES (1, 0, 0)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:sim') RETURNING id)
		INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u`, simToken)
	if err != nil {
		t.Fatal(err)
	}
	s := &sim{t: t, pool: pool, answer: map[string]*big.Int{}, down: map[string]bool{}}
	s.service = NewService(pool, func(_ context.Context, _ uint64, _, holder string) (*big.Int, error) {
		if s.down[holder] {
			return nil, errors.New("second RPC down")
		}
		return new(big.Int).Set(s.answer[holder]), nil
	})
	return s
}

// invoice adds a 5 USDC invoice expiring at simExpires.
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

// transfer writes a transfer row; the chain then holds it.
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

// The second RPC lags at the expiry moment: a fully, timely paid invoice must not expire.
func TestLaggingSecondRPCNeverExpiresAPaidInvoice(t *testing.T) {
	s := newSim(t)
	id, receive := s.invoice()
	s.transfer(id, receive, 5000000, simExpires-10, "confirmed")
	s.finalizedAt(simExpires + 1)
	s.answer[receive] = new(big.Int) // lags: reports nothing yet
	s.process(id)
	if payment, _ := s.payment(id); payment != PartiallyPaid {
		t.Fatalf("while the second RPC lags: %s, want partially_paid (not final)", payment)
	}
	s.answer[receive] = big.NewInt(5000000)
	s.process(id)
	if payment, refund := s.payment(id); payment != Paid || refund != "none" {
		t.Fatalf("once it agrees: %s/%s, want paid/none", payment, refund)
	}
}

// An on-time deposit still waiting to be final (or missed by one log answer) keeps the invoice from expiring.
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

// Money the ledger can't explain (a missed log, an Arc native-coin payment) keeps the invoice from expiring.
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
	s.process(id)
	if payment, _ := s.payment(id); payment != Expired {
		t.Fatalf("once the balance matches the ledger: %s, want expired", payment)
	}
}

// One invoice's failing balance call doesn't stop the others.
func TestProcessChainContinuesAfterAnError(t *testing.T) {
	s := newSim(t)
	broken, brokenReceive := s.invoice()
	ok, okReceive := s.invoice()
	s.transfer(broken, brokenReceive, 5000000, simExpires-10, "confirmed")
	s.transfer(ok, okReceive, 5000000, simExpires-10, "confirmed")
	s.down[brokenReceive] = true
	if err := s.service.ProcessChain(context.Background(), 1); err == nil {
		t.Fatal("ProcessChain hid the failing balance call")
	}
	if payment, _ := s.payment(ok); payment != Paid {
		t.Fatalf("the other invoice: %s, want paid", payment)
	}
}

// An invoice is created open; the database rejects any other first status.
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
