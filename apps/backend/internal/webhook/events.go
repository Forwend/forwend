package webhook

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

var ErrNoEvent = errors.New("webhook event not found")

// Event is an invoice change; history.Add writes it, with its deliveries, in the change's transaction.
type Event struct {
	ID        string
	Type      string
	ProfileID string
	InvoiceID string // "" for a test event
	Livemode  bool
	Sequence  int64 // from 1 per invoice; 0 for a test event
	CreatedAt time.Time
	Held      *Held // invoice.held only
}

type Held struct {
	Amount   string // base units
	Reason   string
	OptionID string
}

const eventColumns = `e.id, e.type, e.profile_id::text, coalesce(e.invoice_id, ''), e.livemode, coalesce(e.sequence, 0),
	e.created_at, coalesce(h.data->>'amount', ''), coalesce(h.data->>'reason', ''), coalesce(h.data->>'option', '')`

func scanEvent(row pgx.Row, extra ...any) (Event, error) {
	var e Event
	var held Held
	if err := row.Scan(append([]any{&e.ID, &e.Type, &e.ProfileID, &e.InvoiceID, &e.Livemode, &e.Sequence, &e.CreatedAt,
		&held.Amount, &held.Reason, &held.OptionID}, extra...)...); err != nil {
		return Event{}, err
	}
	if e.Type == history.Held {
		e.Held = &held
	}
	return e, nil
}

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

const (
	DefaultEventsPage = 50
	MaxEventsPage     = 100
	EventsKept        = 30 * 24 * time.Hour
)

type EventsPage struct {
	Events     []Event
	NextCursor string // "" on the last page
}

// Events lists invoice events (no test events) of the last EventsKept; nil stores or live means all.
func (s *Service) Events(ctx context.Context, profileID string, stores []string, live *bool, kind, cursor string,
	limit int) (EventsPage, error) {
	if limit < 1 || limit > MaxEventsPage {
		return EventsPage{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxEventsPage)
	}
	if kind != "" && !slices.Contains(history.WebhookEvents, kind) {
		return EventsPage{}, fmt.Errorf("%w: type must be one of %v", ErrInvalid, history.WebhookEvents)
	}
	// The cursor is the last history id. Ids are taken at insert, not commit, so an event that commits mid-paging
	// with a lower id than one already seen is skipped.
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
		var historyID int64
		e, err := scanEvent(rows, &historyID)
		if err != nil {
			rows.Close()
			return EventsPage{}, fmt.Errorf("list webhook events: %w", err)
		}
		page.Events, last = append(page.Events, e), append(last, historyID)
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
