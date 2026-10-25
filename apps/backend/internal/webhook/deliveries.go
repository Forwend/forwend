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
	if !lowercaseUUID.MatchString(endpointID) || !eventID.MatchString(event) {
		return ErrNoDelivery
	}
	tag, err := s.pool.Exec(ctx, `UPDATE webhook_deliveries d SET status = 'pending', attempts = 0,
		    next_attempt_at = now(), updated_at = now()
		FROM webhook_endpoints w WHERE w.id = d.endpoint_id AND w.profile_id = $1 AND d.endpoint_id = $2
		  AND d.event_id = $3`, profileID, endpointID, event)
	if err != nil {
		return fmt.Errorf("resend webhook delivery: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNoDelivery
	}
	return nil
}

// ResendFailed sends again every delivery to the endpoint that failed since that time, and says how many.
func (s *Service) ResendFailed(ctx context.Context, profileID, endpointID string, since time.Time) (int64, error) {
	if err := s.owned(ctx, profileID, endpointID); err != nil {
		return 0, err
	}
	tag, err := s.pool.Exec(ctx, `UPDATE webhook_deliveries SET status = 'pending', attempts = 0, next_attempt_at = now(),
		    updated_at = now()
		WHERE endpoint_id = $1 AND status = 'failed' AND updated_at >= $2`, endpointID, since)
	if err != nil {
		return 0, fmt.Errorf("resend failed webhook deliveries: %w", err)
	}
	return tag.RowsAffected(), nil
}

// SendTest queues a test event for the endpoint alone, of its mode, and returns its id.
func (s *Service) SendTest(ctx context.Context, profileID, endpointID string) (string, error) {
	if !lowercaseUUID.MatchString(endpointID) {
		return "", ErrNotFound
	}
	var id string
	err := s.pool.QueryRow(ctx, `WITH e AS (INSERT INTO webhook_events (profile_id, type, livemode)
		    SELECT profile_id, $3, livemode FROM webhook_endpoints WHERE id = $1 AND profile_id = $2 RETURNING id)
		INSERT INTO webhook_deliveries (endpoint_id, event_id) SELECT $1, id FROM e RETURNING event_id`,
		endpointID, profileID, Test).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	} else if err != nil {
		return "", fmt.Errorf("send webhook test event: %w", err)
	}
	return id, nil
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
