package webhook

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

const ProfileConcurrency = 2

// endpointDue is each enabled endpoint e with no request in flight, joined to its first due delivery d. Each endpoint
// reads its own pending index, so a claim costs the profile's endpoints, not the whole backlog.
const endpointDue = `webhook_endpoints e CROSS JOIN LATERAL (SELECT * FROM webhook_deliveries d
   WHERE d.endpoint_id=e.id AND d.status='pending' AND d.next_attempt_at<=now()
     AND (d.leased_until IS NULL OR d.leased_until<=now())
   ORDER BY d.next_attempt_at,d.event_id LIMIT 1) d
 WHERE e.enabled AND NOT EXISTS (
   SELECT 1 FROM webhook_deliveries active WHERE active.endpoint_id=e.id AND active.leased_until>now())`

func (s *Service) claim(ctx context.Context) (*delivery, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var profile string
	err = tx.QueryRow(ctx, `SELECT p.profile_id::text FROM webhook_delivery_profiles p
 WHERE (SELECT count(*) FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id=d.endpoint_id
        WHERE e.profile_id=p.profile_id AND d.leased_until>now()) < $1
 AND EXISTS (SELECT 1 FROM `+endpointDue+` AND e.profile_id=p.profile_id)
 ORDER BY p.last_claimed_at,p.profile_id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`, ProfileConcurrency).Scan(&profile)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// Re-read after the profile lock, so concurrent senders cannot use an older lease count.
	var active int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id=d.endpoint_id
 WHERE e.profile_id=$1 AND d.leased_until>now()`, profile).Scan(&active); err != nil {
		return nil, err
	}
	if active >= ProfileConcurrency {
		return nil, nil
	}
	d := &delivery{profileID: profile}
	err = tx.QueryRow(ctx, `SELECT d.endpoint_id::text,d.event_id,e.url,coalesce(d.body,''),d.attempts,d.updated_at
 FROM `+endpointDue+` AND e.profile_id=$1
 ORDER BY d.next_attempt_at,d.event_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`, profile).
		Scan(&d.endpointID, &d.eventID, &d.url, &d.body, &d.attempts, &d.updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := tx.QueryRow(ctx, `UPDATE webhook_deliveries SET leased_until=clock_timestamp()+$3*interval '1 second'
 WHERE endpoint_id=$1 AND event_id=$2 RETURNING leased_until`, d.endpointID, d.eventID, int64(lease.Seconds())).Scan(&d.leasedUntil); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE webhook_delivery_profiles SET last_claimed_at=clock_timestamp() WHERE profile_id=$1`, profile); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return d, nil
}

// Run keeps free sender slots available while another profile's endpoint waits. A sender that finds nothing waits
// until the one shared poll sees a due delivery, so an empty queue costs one query a second, not one per sender.
func (s *Service) Run(ctx context.Context, client *http.Client, body Body) {
	if s.key == nil {
		<-ctx.Done()
		return
	}
	wake := make(chan struct{}, Batch)
	var workers sync.WaitGroup
	workers.Go(func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			var due bool
			if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM webhook_deliveries d
 JOIN webhook_endpoints e ON e.id=d.endpoint_id WHERE d.status='pending' AND d.next_attempt_at<=now() AND e.enabled
   AND (d.leased_until IS NULL OR d.leased_until<=now()))`).Scan(&due); err != nil && ctx.Err() == nil {
				slog.Error("poll webhook deliveries", "err", err)
				due = true // the senders' own claims report what is wrong
			}
			for due && len(wake) < cap(wake) {
				wake <- struct{}{}
			}
		}
	})
	for range Batch {
		workers.Go(func() {
			for ctx.Err() == nil {
				d, err := s.claim(ctx)
				if err == nil && d != nil {
					err = s.attempt(ctx, client, body, *d)
				}
				if err != nil && ctx.Err() == nil {
					slog.Error("deliver webhook", "err", err)
				}
				if err == nil && d != nil {
					continue
				}
				select {
				case <-ctx.Done():
					return
				case <-wake:
				}
			}
		})
	}
	workers.Wait()
}
