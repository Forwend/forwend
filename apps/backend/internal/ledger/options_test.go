package ledger

import (
	"context"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/history/historytest"
	"github.com/jackc/pgx/v5"
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

// D-76.
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
	if got := chosen(); got != "" {
		t.Fatalf("unfinalized money chose %q", got)
	}
	e.anvil.Mine(2)
	e.run(t)
	if got := chosen(); got != other {
		t.Fatalf("certified money on %s, chosen %q", other, got)
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

	// Past expiry too: the option not chosen only adds the money held on it.
	e.anvil.Wait(4000)
	e.anvil.Mine(3)
	e.run(t)
	got := historytest.Events(t, e.pool, main)
	history := []string{
		fmt.Sprintf(`payer.option_chosen by system {"option": "%s"}`, other),
		"invoice.detected by system",
		"invoice.paid by system",
		"invoice.settlement_queued by system",
		fmt.Sprintf(`invoice.held by system {"amount": "5000000", "option": "%s", "reason": "other_option"}`, main),
	}
	slices.Sort(got) // the two options run in either order
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

// optionSim: the main row on chain 1 and one option on chain 2, both closing at 5000, nothing paid.
type optionSim struct {
	*sim
	main, option, dust, full string // the rows and their receive addresses
}

func newOptionSim(t *testing.T) optionSim {
	t.Helper()
	return newOptionSimFor(t, 5000000)
}

// newOptionSimFor is newOptionSim for an invoice of amount base units.
func newOptionSimFor(t *testing.T, amount int64) optionSim {
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
		SELECT $1, id, 1, 'evm', $2, $4, 5000, 5000 + 86400, '0x1111111111111111111111111111111111111111',
		    'evm_create2', '0x2222222222222222222222222222222222222222', $3, $1, decode(repeat('00', 32), 'hex')
		FROM profiles`, o.main, simToken, o.dust, amount)
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

func TestOptionPaidJustBeforeTheCloseDoesNotExpireTheMainRow(t *testing.T) {
	o := newOptionSim(t)
	o.scanned(1, 4800)
	o.pay(o.option, 2, o.full, 5000000, 4900) // just before the checkout closes at 5000
	o.scanned(2, 5100)                        // past the close too
	o.process(o.option)                       // chosen at once: chain 1's lag doesn't hold it back
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

// F413: a payment final on its own chain is chosen, booked and queued to settle at once; a lagging chain of another
// option doesn't hold it back. Money found there later is held for the payer.
func TestPaymentFinalOnItsChainIsNotHeldBackByOtherChains(t *testing.T) {
	o := newOptionSim(t)
	o.scanned(1, 1000) // the main row's chain lags far behind
	o.pay(o.option, 2, o.full, 5000000, 1400)
	o.scanned(2, 2000)
	o.process(o.option)
	var chosen *string
	var queued bool
	read := func() {
		t.Helper()
		if err := o.pool.QueryRow(context.Background(), `SELECT chosen_id,
			EXISTS (SELECT 1 FROM settlement_intents WHERE invoice_id = $2) FROM invoices WHERE id = $1`, o.main, o.option).
			Scan(&chosen, &queued); err != nil {
			t.Fatal(err)
		}
	}
	read()
	if got, _ := o.payment(o.option); got != Paid || deref(chosen) != o.option || !queued {
		t.Fatalf("the payment final on chain 2: %s, chosen %s, settling %v; want paid, chosen and settling", got,
			deref(chosen), queued)
	}

	o.pay(o.main, 1, o.dust, 1, 1300) // earlier on chain time, found once chain 1 catches up
	o.scanned(1, 2000)
	o.process(o.main)
	read()
	if _, refund := o.payment(o.main); refund != "held" || deref(chosen) != o.option {
		t.Fatalf("money on the other option: refund %s, chosen %s; want held for the payer and the choice kept", refund,
			deref(chosen))
	}
}

func TestEarlyOptionClosePreservesOtherCheckoutOptions(t *testing.T) {
	for _, shortMain := range []bool{true, false} {
		t.Run(fmt.Sprint(shortMain), func(t *testing.T) {
			e := newChainEnv(t)
			initial := e.anvil.Now()
			main, mainReceive := e.invoice(t, 1, 5000000, initial+60*86400)
			other, otherReceive := e.option(t, main, 2)
			short, long, longReceive := main, other, otherReceive
			if !shortMain {
				short, long, longReceive = other, main, mainReceive
			}
			if _, err := e.pool.Exec(t.Context(), "UPDATE invoices SET receiver_deployed_at = $2 WHERE id = $1", short, initial); err != nil {
				t.Fatal(err)
			}
			e.anvil.Wait(30 * 86400)
			e.anvil.Mine(3)
			e.run(t)
			if s := e.state(t, main); s.payment != Open {
				t.Fatalf("one option closed whole checkout: %+v", s)
			}
			e.anvil.Transfer(e.token, longReceive, "5000000")
			e.anvil.Mine(2)
			e.run(t)
			if s := e.state(t, long); s.payment != Paid || s.owed != 5000000 {
				t.Fatalf("available option: %+v", s)
			}
			var chosen *string
			if err := e.pool.QueryRow(t.Context(), "SELECT chosen_id FROM invoices WHERE id = $1", main).Scan(&chosen); err != nil || chosen == nil || *chosen != long {
				t.Fatalf("chosen=%v err=%v", chosen, err)
			}
		})
	}
}

// A deposit under 1 USD never chooses its option: the payer's real payment on another option does, and the small
// deposit is held for the payer.
func TestDustNeverChoosesItsOption(t *testing.T) {
	o := newOptionSim(t)
	o.pay(o.main, 1, o.dust, 10000, 1300) // 0.01 USDC, first on chain
	o.scanned(1, 2000)
	o.process(o.main)
	var chosen *string
	if err := o.pool.QueryRow(context.Background(), "SELECT chosen_id FROM invoices WHERE id = $1", o.main).Scan(&chosen); err != nil {
		t.Fatal(err)
	}
	if got, _ := o.payment(o.main); chosen != nil || got != Open {
		t.Fatalf("after 0.01 USDC: chosen %s, invoice %s; want nothing chosen and the invoice open", deref(chosen), got)
	}
	o.pay(o.option, 2, o.full, 5000000, 1400)
	o.scanned(2, 2000)
	o.process(o.option)
	o.process(o.main)
	if got, _ := o.payment(o.option); got != Paid {
		t.Fatalf("the full payment: %s, want paid", got)
	}
	if _, refund := o.payment(o.main); refund != "held" {
		t.Fatalf("the 0.01 USDC: refund %s, want held for the payer", refund)
	}
	if err := o.pool.QueryRow(context.Background(), "SELECT chosen_id FROM invoices WHERE id = $1", o.main).Scan(&chosen); err != nil ||
		deref(chosen) != o.option {
		t.Fatalf("chosen %s, want %s", deref(chosen), o.option)
	}
}

// A payment sent in parts counts in full once one part brings its option to a tenth of the amount (0.50 USDC here):
// the parts before it pay the creator too, whether they were final in the same worker round or in earlier ones.
func TestPaymentInSmallPartsChoosesItsOption(t *testing.T) {
	for _, rounds := range []string{"one round", "rounds apart"} {
		t.Run(rounds, func(t *testing.T) {
			o := newOptionSim(t)
			o.scanned(1, 2000)
			o.scanned(2, 2000)
			o.pay(o.option, 2, o.full, 300000, 1300)
			if rounds == "rounds apart" {
				o.process(o.option)
			}
			o.pay(o.option, 2, o.full, 300000, 1310) // 0.60 USDC in all: this one chooses the option
			if rounds == "rounds apart" {
				o.process(o.option)
			}
			o.pay(o.option, 2, o.full, 4400000, 1320)
			o.process(o.option)
			a, err := ReadAmounts(context.Background(), o.pool, o.option)
			if err != nil {
				t.Fatal(err)
			}
			if got, refund := o.payment(o.option); got != Paid || refund != "none" || a.Held.Sign() != 0 ||
				a.Payable.Int64() != 5000000 {
				t.Fatalf("after 0.30 + 0.30 + 4.40 USDC: %s, refund %s, held %s, payable %s; want paid with nothing held",
					got, refund, a.Held, a.Payable)
			}
		})
	}
}

// A 1.00 USD payer-chooses invoice paid in two parts: the first part already counts, so the invoice is partly paid,
// and the second completes it; only the surplus is the payer's.
func TestFirstPartOfASmallInvoiceIsAPartialPayment(t *testing.T) {
	o := newOptionSimFor(t, 1000000)
	o.scanned(1, 2000)
	o.scanned(2, 2000)
	o.pay(o.option, 2, o.full, 999973, 1300)
	o.process(o.option)
	if got, refund := o.payment(o.option); got != PartiallyPaid || refund != "none" {
		t.Fatalf("after 0.999973 of 1.00 USDC: %s, refund %s; want partially paid, nothing held", got, refund)
	}
	o.pay(o.option, 2, o.full, 999970, 1310)
	o.process(o.option)
	a, err := ReadAmounts(context.Background(), o.pool, o.option)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := o.payment(o.option); got != Paid || a.Held.Int64() != 999943 || a.Payable.Int64() != 1000000 {
		t.Fatalf("after the second part: %s, held %s, payable %s; want paid, 0.999943 held as overpaid",
			got, a.Held, a.Payable)
	}
}

// A deposit the old 1.00 USD rule booked as held, on an invoice still open, chooses its option under the tenth rule
// once it is past a tenth; it then pays the creator, so the invoice is never locked to an option its payment can't pay.
func TestHeldDepositThatChoosesUnderTheTenthRulePaysTheCreator(t *testing.T) {
	o := newOptionSimFor(t, 1000000)
	ctx := context.Background()
	o.scanned(1, 2000)
	o.scanned(2, 2000)
	o.pay(o.option, 2, o.full, 500000, 1300)
	if err := pgx.BeginFunc(ctx, o.pool, func(tx pgx.Tx) error {
		var id int64
		if err := tx.QueryRow(ctx, "SELECT id FROM chain_transfers WHERE invoice_id = $1", o.option).Scan(&id); err != nil {
			return err
		}
		held := big.NewInt(500000)
		return book(ctx, tx, o.option, "deposit", &id, held, new(big.Int), held)
	}); err != nil {
		t.Fatal(err)
	}
	o.process(o.option)
	a, err := ReadAmounts(ctx, o.pool, o.option)
	if err != nil {
		t.Fatal(err)
	}
	if got, refund := o.payment(o.option); got != PartiallyPaid || refund != "none" || a.Payable.Int64() != 500000 {
		t.Fatalf("the held 0.50 of 1.00 USDC chose its option: %s, refund %s, payable %s; want partially paid with it paid",
			got, refund, a.Payable)
	}
}

// D-26: money that comes after a cancel stays the payer's, even a payment that chooses its option after it.
func TestCanceledPayerChoosesInvoiceKeepsEarlierPartsHeld(t *testing.T) {
	o := newOptionSim(t)
	o.scanned(1, 2000)
	o.scanned(2, 2000)
	o.pay(o.option, 2, o.full, 300000, 1300)
	o.process(o.option)
	o.exec(`UPDATE invoices SET payment_status = 'canceled', canceled_at = now() WHERE coalesce(main_id, id) = $1`, o.main)
	o.pay(o.option, 2, o.full, 300000, 1310) // 0.60 USDC in all: past the option's tenth
	o.process(o.option)
	a, err := ReadAmounts(context.Background(), o.pool, o.option)
	if err != nil {
		t.Fatal(err)
	}
	if a.Payable.Sign() != 0 || a.Held.Int64() != 600000 {
		t.Fatalf("after a cancel: payable %s, held %s; want nothing payable, all 0.60 USDC held", a.Payable, a.Held)
	}
}

// R-130: a reopen gives back what the expiry held, once: a part the choice already gave the creator is not given twice.
func TestReopenAfterAChoiceGivesEachPartOnce(t *testing.T) {
	o := newOptionSimFor(t, 1000000)
	ctx := context.Background()
	o.scanned(1, 2000)
	o.scanned(2, 2000)
	o.pay(o.option, 2, o.full, 50000, 1300) // under the tenth: held while nothing is chosen
	o.process(o.option)
	o.pay(o.option, 2, o.full, 100000, 1310) // chooses the option: both parts pay the creator
	o.process(o.option)
	o.scanned(1, 5100)
	o.scanned(2, 5100)
	o.process(o.option)
	if got, _ := o.payment(o.option); got != ExpiredPartiallyPaid {
		t.Fatalf("after the close: %s, want expired partly paid", got)
	}
	if err := pgx.BeginFunc(ctx, o.pool, func(tx pgx.Tx) error {
		return Reopen(ctx, tx, o.option, 50000)
	}); err != nil {
		t.Fatal(err)
	}
	a, err := ReadAmounts(ctx, o.pool, o.option)
	if err != nil {
		t.Fatal(err)
	}
	if a.Held.Sign() != 0 || a.Payable.Int64() != 150000 {
		t.Fatalf("after the reopen: held %s, payable %s; want nothing held and the 0.15 received payable", a.Held, a.Payable)
	}
}

// The watcher first sees a deposit, then confirms it: 0.01 USDC never makes the invoice confirming or partly paid.
func TestDustSeenThenConfirmedKeepsTheInvoiceOpen(t *testing.T) {
	o := newOptionSim(t)
	o.pay(o.main, 1, o.dust, 10000, 1300)
	o.exec("UPDATE chain_transfers SET status = 'detected'")
	o.scanned(1, 2000)
	o.process(o.main)
	if got, _ := o.payment(o.main); got != Open {
		t.Fatalf("while 0.01 USDC confirms: %s, want open", got)
	}
	o.exec("UPDATE chain_transfers SET status = 'confirmed'")
	o.process(o.main)
	if got, refund := o.payment(o.main); got != Open || refund != "held" {
		t.Fatalf("once 0.01 USDC is final: %s, refund %s; want open with it held", got, refund)
	}
}

// Only a deposit under 1 USD came: the invoice still expires, as unpaid, and the deposit is held for the payer.
func TestDustOnlyExpiresAndIsHeld(t *testing.T) {
	o := newOptionSim(t)
	o.pay(o.main, 1, o.dust, 10000, 1300)
	o.scanned(1, 5100)
	o.scanned(2, 5100)
	o.process(o.main)
	o.process(o.option)
	if got, refund := o.payment(o.main); got != Expired || refund != "held" {
		t.Fatalf("the invoice: %s, refund %s; want expired with the 0.01 USDC held", got, refund)
	}
	// Dust a stranger may send never emails the owner: no held event for it.
	want := []string{"invoice.expired by system"}
	if got := historytest.Events(t, o.pool, o.main); !slices.Equal(got, want) {
		t.Fatalf("history\n got %q\nwant %q", got, want)
	}
}

// R-80: money that comes after a payer-chooses invoice expired unchosen is held, and the owner is told.
func TestLateMoneyAfterAnUnchosenExpiryIsAnnounced(t *testing.T) {
	o := newOptionSim(t)
	o.scanned(1, 5100)
	o.scanned(2, 5100)
	o.process(o.main)
	o.process(o.option)
	o.pay(o.option, 2, o.full, 5000000, 5050)
	o.scanned(2, 5200)
	o.process(o.option)
	if _, refund := o.payment(o.option); refund != "held" {
		t.Fatalf("the late 5.00 USDC: refund %s, want held", refund)
	}
	want := fmt.Sprintf(`invoice.held by system {"amount": "5000000", "option": "%s", "reason": "late"}`, o.option)
	if got := historytest.Events(t, o.pool, o.main); !slices.Contains(got, want) {
		t.Fatalf("history %q lacks %q", got, want)
	}
}

// Dust on an option the payer didn't pay is held without a word to the owner, whether it was booked before or after
// the choice.
func TestDustIsHeldSilentlyInEveryTiming(t *testing.T) {
	for _, order := range []string{"dust booked first", "choice made first"} {
		t.Run(order, func(t *testing.T) {
			o := newOptionSim(t)
			o.scanned(1, 2000)
			o.scanned(2, 2000)
			o.pay(o.main, 1, o.dust, 10000, 1300)
			if order == "dust booked first" {
				o.process(o.main)
			}
			o.pay(o.option, 2, o.full, 5000000, 1400)
			o.process(o.option)
			o.process(o.main)
			if _, refund := o.payment(o.main); refund != "held" {
				t.Fatalf("the 0.01 USDC: refund %s, want held", refund)
			}
			for _, e := range historytest.Events(t, o.pool, o.main) {
				if strings.HasPrefix(e, "invoice.held") {
					t.Fatalf("the owner was told about dust: %q", e)
				}
			}
		})
	}
}
