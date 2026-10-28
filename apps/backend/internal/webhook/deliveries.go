package webhook

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
)

// Test is the event an owner sends to check an endpoint (R-149): it names no invoice, and its data is empty.
const Test = "webhook.test"

// MaxDeliveries is how many of an endpoint's deliveries the list shows, newest first.
const MaxDeliveries = 50

var ErrNoDelivery = errors.New("webhook delivery not found")

var eventID = regexp.MustCompile(`^evt_[0-9a-f]{32}$`)

// Delivery is one event sent to one endpoint, with its attempts, oldest first.
type Delivery struct {
	EventID       string
	Type          string
	InvoiceID     string // "" for a test event
	Number        *int64 // the invoice's; nil for a link invoice before its first deposit, and for a test event
	Status        string
	NextAttemptAt time.Time // while pending
	CreatedAt     time.Time
	Attempts      []Attempt
}

// Attempt is one try: StatusCode is 0 when no answer came, and Error never holds the URL.
type Attempt struct {
	At         time.Time
	StatusCode int
	Error      string
	Duration   time.Duration
}

// Deliveries are the endpoint's MaxDeliveries newest deliveries.
func (s *Service) Deliveries(ctx context.Context, profileID, endpointID string) ([]Delivery, error) {
	if err := s.owned(ctx, profileID, endpointID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT d.event_id, e.type, coalesce(e.invoice_id, ''), m.number, d.status,
		    d.next_attempt_at, d.created_at
		FROM webhook_deliveries d JOIN webhook_events e ON e.id = d.event_id LEFT JOIN invoices m ON m.id = e.invoice_id
		WHERE d.endpoint_id = $1 ORDER BY d.created_at DESC, d.event_id LIMIT $2`, endpointID, MaxDeliveries)
	if err != nil {
		return nil, fmt.Errorf("list webhook deliveries: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Delivery, error) {
		var d Delivery
		err := row.Scan(&d.EventID, &d.Type, &d.InvoiceID, &d.Number, &d.Status, &d.NextAttemptAt, &d.CreatedAt)
		return d, err
	})
	if err != nil {
		return nil, fmt.Errorf("list webhook deliveries: %w", err)
	}
	ids := make([]string, len(list))
	at := map[string]int{}
	for i, d := range list {
		ids[i], at[d.EventID] = d.EventID, i
	}
	rows, err = s.pool.Query(ctx, `SELECT event_id, at, coalesce(status_code, 0), coalesce(error, ''), duration_ms
		FROM webhook_attempts WHERE endpoint_id = $1 AND event_id = ANY ($2) ORDER BY id`, endpointID, ids)
	if err != nil {
		return nil, fmt.Errorf("list webhook attempts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var a Attempt
		var ms int64
		if err := rows.Scan(&id, &a.At, &a.StatusCode, &a.Error, &ms); err != nil {
			return nil, fmt.Errorf("list webhook attempts: %w", err)
		}
		a.Duration = time.Duration(ms) * time.Millisecond
		list[at[id]].Attempts = append(list[at[id]].Attempts, a)
	}
	return list, rows.Err()
}

// Resend sends a delivery again from a first attempt, with the body it first sent. It waits while the endpoint is off.
func (s *Service) Resend(ctx context.Context, profileID, endpointID, event string) error {
	if s.key == nil {
		return ErrNotConfigured
	}
	if !lowercaseUUID.MatchString(endpointID) || !eventID.MatchString(event) {
		return ErrNoDelivery
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		room, err := manualQueueRoom(ctx, tx, profileID)
		if err != nil {
			return err
		}
		var pending bool
		err = tx.QueryRow(ctx, `SELECT d.status='pending' FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id=d.endpoint_id
 WHERE e.profile_id=$1 AND d.endpoint_id=$2 AND d.event_id=$3 FOR UPDATE OF d`, profileID, endpointID, event).Scan(&pending)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNoDelivery
		}
		if err != nil {
			return err
		}
		if !pending && room == 0 {
			return ErrQueueFull
		}
		_, err = tx.Exec(ctx, `UPDATE webhook_deliveries SET status='pending',attempts=0,next_attempt_at=now(),updated_at=clock_timestamp()
 WHERE endpoint_id=$1 AND event_id=$2`, endpointID, event)
		return err
	})
}

// ResendFailed sends again every delivery to the endpoint that failed since that time, and says how many.
func (s *Service) ResendFailed(ctx context.Context, profileID, endpointID string, since time.Time) (int64, error) {
	if s.key == nil {
		return 0, ErrNotConfigured
	}
	if err := s.owned(ctx, profileID, endpointID); err != nil {
		return 0, err
	}
	var queued int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		room, err := manualQueueRoom(ctx, tx, profileID)
		if err != nil {
			return err
		}
		if room == 0 {
			return ErrQueueFull
		}
		tag, err := tx.Exec(ctx, `UPDATE webhook_deliveries d SET status='pending',attempts=0,next_attempt_at=now(),updated_at=clock_timestamp()
 FROM (SELECT endpoint_id,event_id FROM webhook_deliveries WHERE endpoint_id=$1 AND status='failed' AND updated_at>=$2
 ORDER BY updated_at,event_id LIMIT $3 FOR UPDATE SKIP LOCKED) q WHERE d.endpoint_id=q.endpoint_id AND d.event_id=q.event_id`, endpointID, since, room)
		if err != nil {
			return err
		}
		queued = tag.RowsAffected()
		return nil
	})
	return queued, err
}

// SendTest queues a test event for the endpoint alone, of its mode, and returns its id.
func (s *Service) SendTest(ctx context.Context, profileID, endpointID string) (string, error) {
	if s.key == nil {
		return "", ErrNotConfigured
	}
	if !lowercaseUUID.MatchString(endpointID) {
		return "", ErrNotFound
	}
	var id string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		room, err := manualQueueRoom(ctx, tx, profileID)
		if err != nil {
			return err
		}
		if room == 0 {
			return ErrQueueFull
		}
		err = tx.QueryRow(ctx, `WITH e AS (INSERT INTO webhook_events(profile_id,type,livemode)
 SELECT profile_id,$3,livemode FROM webhook_endpoints WHERE id=$1 AND profile_id=$2 RETURNING id)
 INSERT INTO webhook_deliveries(endpoint_id,event_id) SELECT $1,id FROM e RETURNING event_id`, endpointID, profileID, Test).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	return id, err
}

// owned is ErrNotFound unless the endpoint is the profile's.
func (s *Service) owned(ctx context.Context, profileID, endpointID string) error {
	var ok bool
	if lowercaseUUID.MatchString(endpointID) {
		if err := s.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM webhook_endpoints WHERE id = $1 AND profile_id = $2)",
			endpointID, profileID).Scan(&ok); err != nil {
			return fmt.Errorf("read webhook endpoint: %w", err)
		}
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}
