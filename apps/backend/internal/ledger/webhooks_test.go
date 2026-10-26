package ledger

import (
	"context"
	"math/big"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/history/historytest"
	"github.com/jackc/pgx/v5"
)

const allEvents = "{invoice.detected,invoice.partially_paid,invoice.paid,invoice.settled,invoice.expired,invoice.canceled," +
	"invoice.held}"

// endpoint gives the profile a webhook endpoint named by its description.
func (e chainEnv) endpoint(t *testing.T, name, events string, enabled, livemode bool) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO webhook_endpoints (id, profile_id, url, description,
		    events, enabled, livemode)
		SELECT gen_random_uuid(), id, 'https://hooks.example/', $1, $2::text[], $3, $4 FROM profiles`,
		name, events, enabled, livemode); err != nil {
		t.Fatal(err)
	}
}

// R-147: each status change is one event, in order, to the endpoints that take it: on, of its mode, and of its type.
func TestPaymentsBecomeWebhookEvents(t *testing.T) {
	e := newChainEnv(t)
	e.endpoint(t, "all", allEvents, true, false)
	e.endpoint(t, "paid", "{invoice.paid}", true, false)
	e.endpoint(t, "off", allEvents, false, false)
	e.endpoint(t, "live", allEvents, true, true)
	id, receive := e.invoice(t, 1, 5000000, e.anvil.Now()+3600)

	e.anvil.Transfer(e.token, receive, "3000000")
	e.run(t)
	e.anvil.Mine(2)
	e.run(t)
	e.anvil.Transfer(e.token, receive, "3000000")
	e.anvil.Mine(2)
	e.run(t)
	e.run(t)
	want := []string{"1 invoice.detected to all", "2 invoice.partially_paid to all", "3 invoice.paid to all,paid",
		"4 invoice.held overpaid to all"}
	if got := historytest.Webhooks(t, e.pool, id); !reflect.DeepEqual(got, want) {
		t.Fatalf("webhook events\n got %q\nwant %q", got, want)
	}
}

// R-80: a run that holds money for two reasons tells the owner once, with the total; the history has a row for each.
func TestOneRunHoldsForTwoReasons(t *testing.T) {
	s := newSim(t)
	id, receive := s.invoice()
	s.transfer(id, receive, 2000000, simExpires-10, "confirmed")
	s.answer[receive] = big.NewInt(2000000)
	s.process(id)
	s.transfer(id, receive, 1000000, simExpires+10, "confirmed")
	s.answer[receive] = big.NewInt(3000000)
	s.finalizedAt(simExpires + 20)
	s.process(id)
	var told []string
	rows, err := s.pool.Query(context.Background(), `SELECT payload->>'amount' FROM outbox_events
		WHERE invoice_id = $1 AND kind = 'invoice.held'`, id)
	if err == nil {
		told, err = pgx.CollectRows(rows, pgx.RowTo[string])
	}
	if err != nil || !slices.Equal(told, []string{"3000000"}) {
		t.Fatalf("held money told %q (%v), want once with 3000000", told, err)
	}
	held := slices.DeleteFunc(historytest.Events(t, s.pool, id), func(e string) bool {
		return !strings.HasPrefix(e, "invoice.held")
	})
	want := []string{`invoice.held by system {"amount": "1000000", "reason": "late"}`,
		`invoice.held by system {"amount": "2000000", "reason": "expired"}`}
	if !reflect.DeepEqual(held, want) {
		t.Fatalf("held history\n got %q\nwant %q", held, want)
	}
}
