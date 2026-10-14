package ledger

import (
	"context"
	"fmt"
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
