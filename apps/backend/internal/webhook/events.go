package webhook

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
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
	InvoiceID string // "" for a test event (R-149)
	Livemode  bool
	Sequence  int64 // the invoice's events in order, from 1; 0 for a test event
	CreatedAt time.Time
	Held      *Held // invoice.held only
}

// Held is the money an invoice.held event holds for the payer (D-26).
type Held struct {
	Amount   string // base units of the invoice token
	Reason   string // one of the ledger's Held reasons
	OptionID string // the option it is held on, when the invoice has several
}

const eventColumns = `e.id, e.type, e.profile_id::text, coalesce(e.invoice_id, ''), e.livemode, coalesce(e.sequence, 0),
	e.created_at, coalesce(h.data->>'amount', ''), coalesce(h.data->>'reason', ''), coalesce(h.data->>'option', '')`

// scanEvent reads eventColumns, then any columns after them into extra.
func scanEvent(row pgx.Row, extra ...any) (Event, error) {
	var e Event
	var held Held
	if err := row.Scan(append([]any{&e.ID, &e.Type, &e.ProfileID, &e.InvoiceID, &e.Livemode, &e.Sequence, &e.CreatedAt,
		&held.Amount, &held.Reason, &held.OptionID}, extra...)...); err != nil {
		return Event{}, err
	}
	if e.Type == InvoiceHeld {
		e.Held = &held
	}
	return e, nil
}

// Event reads one event.
func (s *Service) Event(ctx context.Context, id string) (Event, error) {
	e, err := scanEvent(s.pool.QueryRow(ctx, `SELECT `+eventColumns+`
		FROM webhook_events e LEFT JOIN history_events h ON h.id = e.history_id WHERE e.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrNoEvent
	} else if err != nil {
		return Event{}, fmt.Errorf("read webhook event %s: %w", id, err)
	}
	return e, nil
}

// The events list (R-153, D-102): pages of 50 by default, up to 100, reaching back EventsKept.
const (
	DefaultEventsPage = 50
	MaxEventsPage     = 100
	EventsKept        = 30 * 24 * time.Hour
)

// EventsPage is one page of events, newest first; NextCursor is "" on the last one.
type EventsPage struct {
	Events     []Event
	NextCursor string
}

// Events lists the profile's invoice events of the last EventsKept, newest first; test events are not listed.
// stores, when not nil, keeps only those stores' invoices; live, when not nil, only that mode's (D-87); kind, when
// set, one event type.
func (s *Service) Events(ctx context.Context, profileID string, stores []string, live *bool, kind, cursor string,
	limit int) (EventsPage, error) {
	if limit < 1 || limit > MaxEventsPage {
		return EventsPage{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxEventsPage)
	}
	if kind != "" && !slices.Contains(EventTypes, kind) {
		return EventsPage{}, fmt.Errorf("%w: type must be one of %v", ErrInvalid, EventTypes)
	}
	// The cursor is the last event's history row, so a page never repeats one. An id is taken at insert, not at
	// commit: an event that commits while a client pages, with a lower id than one it saw, is not on a later page.
	var after *int64
	if cursor != "" {
		n, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil || n < 1 {
			return EventsPage{}, fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
		}
		after = &n
	}
	rows, err := s.pool.Query(ctx, `SELECT `+eventColumns+`, e.history_id
		FROM webhook_events e JOIN history_events h ON h.id = e.history_id JOIN invoices m ON m.id = e.invoice_id
		WHERE e.profile_id = $1 AND e.created_at > now() - $2 * interval '1 second'
		  AND ($3::uuid[] IS NULL OR m.store_id = ANY ($3)) AND ($4 = '' OR e.type = $4)
		  AND ($5::bigint IS NULL OR e.history_id < $5) AND ($7::boolean IS NULL OR e.livemode = $7)
		ORDER BY e.history_id DESC LIMIT $6`, profileID, int64(EventsKept.Seconds()), stores, kind, after, limit+1, live)
	if err != nil {
		return EventsPage{}, fmt.Errorf("list webhook events: %w", err)
	}
	var page EventsPage
	var last []int64
	for rows.Next() {
		var history int64
		e, err := scanEvent(rows, &history)
		if err != nil {
			rows.Close()
			return EventsPage{}, fmt.Errorf("list webhook events: %w", err)
		}
		page.Events, last = append(page.Events, e), append(last, history)
	}
	if err := rows.Err(); err != nil {
		return EventsPage{}, fmt.Errorf("list webhook events: %w", err)
	}
	if len(page.Events) > limit {
		page.Events = page.Events[:limit]
		page.NextCursor = strconv.FormatInt(last[limit-1], 10)
	}
	return page, nil
}
