package ledger

import (
	"context"
	"fmt"
	"math/big"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
)

// option adds an accepted option of invoice main (R-56): its own id and receive address, the main row's other terms.
func (e chainEnv) option(t *testing.T, main string, n int) (id, receive string) {
	t.Helper()
	id, receive = fmt.Sprintf("0x%064x", n), fmt.Sprintf("0x%040x", 0xa0+n)
	_, err := e.pool.Exec(context.Background(), `
		INSERT INTO invoices (id, main_id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		    request_hash)
		SELECT $1, m.id, m.profile_id, $2, 'evm', m.token_contract, m.amount, m.expires_at, m.settle_deadline,
		    m.recipient_address, m.receive_method, m.factory_address, $3, m.idempotency_key, m.request_hash
		FROM invoices m WHERE m.id = $4`, id, chaintest.ChainID, receive, main)
	if err != nil {
		t.Fatal(err)
	}
	return id, receive
}

// The first option that receives money becomes the invoice's (D-76): it is paid and settled as usual, and money sent
// to another option afterwards is held for the payer, never owed to the creator.
func TestFirstOptionPaidWinsAndOthersAreHeld(t *testing.T) {
	ctx := context.Background()
	e := newChainEnv(t)
	main, mainReceive := e.invoice(t, 1, 5000000, e.anvil.Now()+3600)
	other, otherReceive := e.option(t, main, 2)
	chosen := func() string {
		t.Helper()
		var id *string
		if err := e.pool.QueryRow(ctx, "SELECT chosen_id FROM invoices WHERE id = $1", main).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if id == nil {
			return ""
		}
		return *id
	}

	e.run(t)
	if got := chosen(); got != "" {
		t.Fatalf("no money yet, but option %s is chosen", got)
	}
	e.anvil.Transfer(e.token, otherReceive, "5000000")
	e.run(t)
	if got := chosen(); got != other {
		t.Fatalf("money seen on %s, chosen %q", other, got)
	}

	e.anvil.Transfer(e.token, mainReceive, "5000000") // the payer pays again, to the option not chosen
	e.anvil.Mine(2)
	e.run(t)
	want(t, "chosen option", e.state(t, other), state{payment: Paid, refund: "none", receiver: 5000000, owed: 5000000})
	want(t, "the other option", e.state(t, main), state{payment: Detected, refund: "held", receiver: 5000000, held: 5000000})
	if got := chosen(); got != other {
		t.Fatalf("the choice moved to %q", got)
	}

	// Only the chosen option settles, and the invoice people see is the chosen option.
	var intents int
	var current, payment string
	if err := e.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM settlement_intents WHERE invoice_id IN ($1, $2)),
		option_id, payment_status FROM invoices_current WHERE id = $1`, main, other).
		Scan(&intents, &current, &payment); err != nil {
		t.Fatal(err)
	}
	if intents != 1 || current != other || payment != Paid {
		t.Fatalf("%d settlement intents; the invoice shows option %s %s, want 1, %s paid", intents, current, payment, other)
	}
	var settles string
	if err := e.pool.QueryRow(ctx, "SELECT invoice_id FROM settlement_intents").Scan(&settles); err != nil || settles != other {
		t.Fatalf("settlement intent for %q (%v), want %s", settles, err, other)
	}
}

func TestOptionPaidFirstOnChainIsChosen(t *testing.T) {
	ctx := context.Background()
	e := newChainEnv(t)
	main, mainReceive := e.invoice(t, 1, 5000000, e.anvil.Now()+3600)
	other, otherReceive := e.option(t, main, 2)
	e.run(t)

	e.anvil.Transfer(e.token, otherReceive, "5000000")
	e.anvil.Transfer(e.token, mainReceive, "1")
	e.anvil.Mine(2)
	e.run(t)

	var chosen *string
	if err := e.pool.QueryRow(ctx, "SELECT chosen_id FROM invoices WHERE id = $1", main).Scan(&chosen); err != nil {
		t.Fatal(err)
	}
	if chosen == nil || *chosen != other {
		t.Fatalf("chosen option %v, want %s (paid first on chain); main %+v, option %+v",
			deref(chosen), other, e.state(t, main), e.state(t, other))
	}
	want(t, "option paid first", e.state(t, other), state{payment: Paid, refund: "none", receiver: 5000000, owed: 5000000})
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

// R-119: the worker reads one chain after another, so a later transfer on a chain read first must not take the choice
// from an earlier full payment on a chain not read that far yet (audit 2026-10-19: dust took over a paid invoice).
// The option is chosen, and its deposits booked, only once every other enabled option chain was read past the first
// one.
func TestOptionWaitsForEveryChainBeforeChoosing(t *testing.T) {
	s := newSim(t)
	s.exec(`WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (2, 'evm', 'sim2', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (2, 'evm', $1, 'USDC', 6, true))
		INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES (2, 100, 100)`, simToken)

	pay := func(id string, chainID int, receive string, amount, blockTime int64) {
		s.n++
		s.exec(`INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			    block_hash, block_number, block_time, from_address, to_address, amount, status)
			VALUES ($1, 'evm', $2, $3, $4, 0, $4, $5, $6, '0x00000000000000000000000000000000000000ff', $7, $8, 'confirmed')`,
			chainID, simToken, id, fmt.Sprintf("0x%064x", s.n), s.n, blockTime, receive, amount)
		s.answer[receive].Add(s.answer[receive], big.NewInt(amount))
	}
	main, dust := fmt.Sprintf("0x%064x", 0xa1), "0x00000000000000000000000000000000000000a1"
	option, full := fmt.Sprintf("0x%064x", 0xa2), "0x00000000000000000000000000000000000000a2"
	s.exec(`INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		    request_hash)
		SELECT $1, id, 1, 'evm', $2, 5000000, 5000, 5000 + 86400, '0x1111111111111111111111111111111111111111',
		    'evm_create2', '0x2222222222222222222222222222222222222222', $3, $1, decode(repeat('00', 32), 'hex')
		FROM profiles`, main, simToken, dust)
	s.answer[dust] = new(big.Int)
	s.exec(`INSERT INTO invoices (id, main_id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		    request_hash)
		SELECT $1, m.id, m.profile_id, 2, 'evm', m.token_contract, m.amount, m.expires_at, m.settle_deadline,
		    m.recipient_address, m.receive_method, m.factory_address, $2, m.idempotency_key, m.request_hash
		FROM invoices m WHERE m.id = $3`, option, full, main)
	s.answer[full] = new(big.Int)
	scanned := func(chainID, time int64) {
		s.exec("UPDATE chain_cursors SET last_scanned_time = $2, last_finalized_time = $2 WHERE chain_id = $1", chainID,
			time)
	}

	// Chain 1 is read first: it has the dust at 1500, and chain 2 was read only to 1000.
	scanned(1, 2000)
	scanned(2, 1000)
	pay(main, 1, dust, 1, 1500)
	s.process(main)
	var chosen *string
	if err := s.pool.QueryRow(context.Background(), "SELECT chosen_id FROM invoices WHERE id = $1", main).Scan(&chosen); err != nil || chosen != nil {
		t.Fatalf("chosen %v (%v) before chain 2 was read past the dust, want none", deref(chosen), err)
	}
	// Chain 2's read finds the full payment, made at 1400, before the dust.
	pay(option, 2, full, 5000000, 1400)
	scanned(2, 2000)
	s.process(option)
	s.process(main)
	if got, _ := s.payment(option); got != Paid {
		t.Fatalf("the option paid in full first: %s, want paid", got)
	}
	if got, refund := s.payment(main); refund != "held" {
		t.Fatalf("the dust: %s, refund %s; want held for the payer", got, refund)
	}
}
