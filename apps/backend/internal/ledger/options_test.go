package ledger

import (
	"context"
	"fmt"
	"math/big"
	"slices"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/history/historytest"
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

	// The two options run in either order.
	e.anvil.Wait(4000)
	e.anvil.Mine(3)
	e.run(t)
	got := historytest.Events(t, e.pool, main)
	history := []string{
		fmt.Sprintf(`payer.option_chosen by system {"option": "%s"}`, other),
		"invoice.detected by system",
		"invoice.paid by system",
		"invoice.settlement_queued by system",
		fmt.Sprintf(`invoice.held by system {"amount": "5000000", "option": "%s"}`, main),
	}
	slices.Sort(got)
	slices.Sort(history)
	if !slices.Equal(got, history) {
		t.Fatalf("history\n got %q\nwant %q", got, history)
	}
}

func TestUnpaidOptionsExpireOnce(t *testing.T) {
	e := newChainEnv(t)
	main, _ := e.invoice(t, 1, 5000000, e.anvil.Now()+1000)
	e.option(t, main, 2)
	e.option(t, main, 3)
	e.anvil.Wait(2000)
	e.anvil.Mine(3)
	e.run(t)
	if got := historytest.Events(t, e.pool, main); !slices.Equal(got, []string{"invoice.expired by system"}) {
		t.Fatalf("history %q, want one invoice.expired", got)
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

// optionSim is a payer-chooses invoice in the sim: its main row on chain 1 and one option on chain 2, both closing at
// 5000, with nothing paid yet.
type optionSim struct {
	*sim
	main, option, dust, full string // the rows and their receive addresses
}

func newOptionSim(t *testing.T) optionSim {
	t.Helper()
	s := newSim(t)
	s.exec(`WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (2, 'evm', 'sim2', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES (2, 'evm', $1, 'USDC', 6, true))
		INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES (2, 100, 100)`, simToken)
	o := optionSim{sim: s, main: fmt.Sprintf("0x%064x", 0xa1), dust: "0x00000000000000000000000000000000000000a1",
		option: fmt.Sprintf("0x%064x", 0xa2), full: "0x00000000000000000000000000000000000000a2"}
	s.exec(`INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		    request_hash)
		SELECT $1, id, 1, 'evm', $2, 5000000, 5000, 5000 + 86400, '0x1111111111111111111111111111111111111111',
		    'evm_create2', '0x2222222222222222222222222222222222222222', $3, $1, decode(repeat('00', 32), 'hex')
		FROM profiles`, o.main, simToken, o.dust)
	s.answer[o.dust] = new(big.Int)
	s.exec(`INSERT INTO invoices (id, main_id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
		    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
		    request_hash)
		SELECT $1, m.id, m.profile_id, 2, 'evm', m.token_contract, m.amount, m.expires_at, m.settle_deadline,
		    m.recipient_address, m.receive_method, m.factory_address, $2, m.idempotency_key, m.request_hash
		FROM invoices m WHERE m.id = $3`, o.option, o.full, o.main)
	s.answer[o.full] = new(big.Int)
	return o
}

func (o optionSim) pay(id string, chainID int, receive string, amount, blockTime int64) {
	o.n++
	o.exec(`INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		VALUES ($1, 'evm', $2, $3, $4, 0, $4, $5, $6, '0x00000000000000000000000000000000000000ff', $7, $8, 'confirmed')`,
		chainID, simToken, id, fmt.Sprintf("0x%064x", o.n), o.n, blockTime, receive, amount)
	o.answer[receive].Add(o.answer[receive], big.NewInt(amount))
}

// scanned says the chain was read, and is final, up to time.
func (o optionSim) scanned(chainID, time int64) {
	o.exec("UPDATE chain_cursors SET last_scanned_time = $2, last_finalized_time = $2 WHERE chain_id = $1", chainID, time)
}

func TestMainRowWaitsForTheChoiceBeforeExpiring(t *testing.T) {
	o := newOptionSim(t)
	o.scanned(1, 4800)
	o.pay(o.option, 2, o.full, 5000000, 4900) // just before the checkout closes at 5000
	o.scanned(2, 5100)                        // past the close too: only the pending choice keeps the main row open
	o.process(o.option)                       // chain 1 was read only to 4800: no choice yet
	o.scanned(1, 5100)                        // read past the close, and past the payment
	o.process(o.main)
	o.process(o.option)
	if got, _ := o.payment(o.option); got != Paid {
		t.Fatalf("the option: %s, want paid", got)
	}
	want := []string{fmt.Sprintf(`payer.option_chosen by system {"option": "%s"}`, o.option), "invoice.paid by system",
		"invoice.settlement_queued by system"}
	if got := historytest.Events(t, o.pool, o.main); !slices.Equal(got, want) {
		t.Fatalf("history\n got %q\nwant %q", got, want)
	}
}

func TestInvoiceClosesOnlyOnceEveryOptionChainIsReadPastIt(t *testing.T) {
	o := newOptionSim(t)
	o.scanned(2, 4800)
	o.scanned(1, 5100)
	o.process(o.main) // chain 2 was read only to 4800: the main row must not close yet
	if got, _ := o.payment(o.main); got != Open {
		t.Fatalf("the main row before chain 2 was read past the close: %s, want open", got)
	}
	o.pay(o.option, 2, o.full, 5000000, 4900)
	o.scanned(2, 5100)
	o.process(o.option)
	o.process(o.main)
	if got, _ := o.payment(o.option); got != Paid {
		t.Fatalf("the option: %s, want paid", got)
	}
	want := []string{fmt.Sprintf(`payer.option_chosen by system {"option": "%s"}`, o.option), "invoice.paid by system",
		"invoice.settlement_queued by system"}
	if got := historytest.Events(t, o.pool, o.main); !slices.Equal(got, want) {
		t.Fatalf("history\n got %q\nwant %q", got, want)
	}
}

func TestOptionWaitsForEveryChainBeforeChoosing(t *testing.T) {
	o := newOptionSim(t)
	s, main, dust, option, full := o.sim, o.main, o.dust, o.option, o.full
	pay, scanned := o.pay, o.scanned

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
