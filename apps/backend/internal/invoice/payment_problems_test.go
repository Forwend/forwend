package invoice

import (
	"context"
	"math/big"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

// The held money's reason is the one the ledger wrote, not a guess from the status (D-26).
func TestHeldMoneyNamesTheLedgerReason(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	create := func(key string) Invoice {
		t.Helper()
		inv, _, err := s.Create(ctx, profile, key, Request{ChainID: 84532, Token: usdc, Amount: "5000000"})
		if err != nil {
			t.Fatal(err)
		}
		return inv
	}
	event := func(inv Invoice, kind, option, reason string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `INSERT INTO history_events (invoice_id, kind, actor, data)
			VALUES ($1, $2, 'system', jsonb_strip_nulls(jsonb_build_object('amount', '100000',
			    'reason', nullif($3::text, ''), 'option', nullif($4::text, ''))))`,
			inv.ID, kind, reason, option); err != nil {
			t.Fatal(err)
		}
	}
	paid := create("paid") // paid, then more after the close: the ledger wrote late
	event(paid, history.Held, "", ledger.HeldLate)
	event(paid, history.Held, "", ledger.HeldLate)
	mixed := create("mixed") // over the amount, then late: no one reason is true for the whole sum
	event(mixed, history.Held, "", ledger.HeldOverpaid)
	event(mixed, history.Held, "", ledger.HeldLate)
	reopened := create("reopened") // the reopen counted the partial payment; only the late money after it is held
	event(reopened, history.Held, "", ledger.HeldExpired)
	event(reopened, history.Reopened, "", "")
	event(reopened, history.Held, "", ledger.HeldLate)
	chooses := create("chooses") // a payer-chooses invoice keys each hold by its option
	event(chooses, history.Held, "child-option", ledger.HeldOtherOption)
	dust := create("dust") // on-time dust that chose nothing: the ledger writes no reason
	reasons, err := readHeldReasons(ctx, pool, []string{paid.ID, mixed.ID, reopened.ID, chooses.ID, dust.ID})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{paid.ID: ledger.HeldLate, mixed.ID: "", reopened.ID: ledger.HeldLate,
		"child-option": ledger.HeldOtherOption}
	if len(reasons) != len(want) {
		t.Fatalf("reasons %v, want %v", reasons, want)
	}
	for option, reason := range want {
		if got, ok := reasons[option]; !ok || got.Reason != reason {
			t.Fatalf("reasons %v, want %v", reasons, want)
		}
	}
	if reasons[paid.ID].Amount.Int64() != 200_000 {
		t.Fatalf("paid holds sum to %s", reasons[paid.ID].Amount)
	}
	reason := func(held int64) string {
		t.Helper()
		option := PaymentOption{
			Option: Option{ID: paid.ID, Amount: big.NewInt(5_000_000), Amounts: &ledger.Amounts{
				Receiver: big.NewInt(5_000_000 + held), Payable: big.NewInt(5_000_000), Held: big.NewInt(held)}},
			State:       &ledger.ReceiverState{PaymentStatus: ledger.Paid},
			HeldHistory: reasons[paid.ID],
		}
		var found []PaymentProblem
		for _, p := range optionProblems(paid, option, time.Now()) {
			if p.Code == ProblemHeldFunds {
				found = append(found, p)
			}
		}
		if len(found) != 1 || found[0].Amount.Int64() != held {
			t.Fatalf("held problems %+v", found)
		}
		return found[0].Reason
	}
	// The late holds are all that is held: they name it.
	if got := reason(200_000); got != ledger.HeldLate {
		t.Fatalf("a paid invoice with late money says %q", got)
	}
	// Dust held before them, with no reason written, is in the sum too: no reason fits the whole.
	if got := reason(250_000); got != "" {
		t.Fatalf("late money over dust says %q", got)
	}
}
