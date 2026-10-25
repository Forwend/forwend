package webhook

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrNoEvent: no webhook event has this id.
var ErrNoEvent = errors.New("webhook event not found")

// Event is a change to an invoice that endpoints may take (R-147). history.Add writes it in the transaction that
// makes the change, with a delivery for each endpoint that takes it then.
type Event struct {
	ID        string
	Type      string
	ProfileID string
	InvoiceID string
	Livemode  bool
	Sequence  int64 // the invoice's events in order, from 1
	CreatedAt time.Time
	Held      *Held // invoice.held only
}

// Held is the money an invoice.held event holds for the payer (D-26).
type Held struct {
	Amount   string // base units of the invoice token
	Reason   string // one of the ledger's Held reasons
	OptionID string // the option it is held on, when the invoice has several
}

// Event reads one event.
func (s *Service) Event(ctx context.Context, id string) (Event, error) {
	var e Event
	var held Held
	err := s.pool.QueryRow(ctx, `SELECT e.id, e.type, e.profile_id::text, e.invoice_id, e.livemode, e.sequence,
		    e.created_at, coalesce(h.data->>'amount', ''), coalesce(h.data->>'reason', ''),
		    coalesce(h.data->>'option', '')
		FROM webhook_events e JOIN history_events h ON h.id = e.history_id WHERE e.id = $1`, id).Scan(&e.ID, &e.Type,
		&e.ProfileID, &e.InvoiceID, &e.Livemode, &e.Sequence, &e.CreatedAt, &held.Amount, &held.Reason, &held.OptionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrNoEvent
	} else if err != nil {
		return Event{}, fmt.Errorf("read webhook event %s: %w", id, err)
	}
	if e.Type == InvoiceHeld {
		e.Held = &held
	}
	return e, nil
}
