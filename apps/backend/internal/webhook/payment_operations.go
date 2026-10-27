package webhook

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type operationsReader interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type PaymentDelivery struct {
	EndpointID, EventID, EventType, Status string
	Enabled                                bool
	Total                                  int64
	Attempts                               int64
	LastStatusCode                         *int
	LastAttemptAt                          *time.Time
	NextAttemptAt                          time.Time
}

func PaymentDeliveries(ctx context.Context, db operationsReader, id string) ([]PaymentDelivery, error) {
	rows, err := db.Query(ctx, `SELECT d.endpoint_id::text,d.event_id,e.type,d.status,w.enabled,count(*) OVER (),d.attempts,
    attempt.status_code,attempt.at,d.next_attempt_at
 FROM webhook_events e JOIN webhook_deliveries d ON d.event_id = e.id JOIN webhook_endpoints w ON w.id = d.endpoint_id
 LEFT JOIN LATERAL (SELECT a.status_code,a.at FROM webhook_attempts a WHERE a.endpoint_id = d.endpoint_id
     AND a.event_id = d.event_id ORDER BY a.id DESC LIMIT 1) attempt ON true
 WHERE e.invoice_id = $1 ORDER BY (d.status = 'failed' OR NOT w.enabled AND d.status = 'pending') DESC,e.sequence DESC,d.endpoint_id LIMIT 100`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[PaymentDelivery])
}

func ProblemDeliveries(ctx context.Context, db operationsReader, ids []string) (map[string]PaymentDelivery, error) {
	rows, err := db.Query(ctx, `SELECT DISTINCT ON (e.invoice_id) e.invoice_id,d.endpoint_id::text,d.event_id
  FROM webhook_events e JOIN webhook_deliveries d ON d.event_id = e.id JOIN webhook_endpoints endpoint ON endpoint.id = d.endpoint_id
  WHERE e.invoice_id = ANY($1::text[]) AND (d.status = 'failed' OR NOT endpoint.enabled AND d.status = 'pending')
  ORDER BY e.invoice_id,e.sequence DESC,d.endpoint_id`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]PaymentDelivery)
	for rows.Next() {
		var id string
		var delivery PaymentDelivery
		if err := rows.Scan(&id, &delivery.EndpointID, &delivery.EventID); err != nil {
			return nil, err
		}
		result[id] = delivery
	}
	return result, rows.Err()
}

type EndpointProblem struct {
	ID, StoreID, Description string
	Enabled, Livemode        bool
	Failed, DisabledPending  int64
	LastProblemAt            time.Time
}

func ProblemEndpoints(ctx context.Context, db operationsReader, profileID, storeID string, live *bool, limit int) ([]EndpointProblem, error) {
	args := []any{profileID, limit + 1}
	where := "w.profile_id = $1"
	if storeID != "" {
		args = append(args, storeID)
		where += fmt.Sprintf(" AND (m.store_id = $%d::uuid OR e.invoice_id IS NULL AND w.store_id = $%d::uuid)", len(args), len(args))
	}
	if live != nil {
		args = append(args, *live)
		where += fmt.Sprintf(" AND w.livemode = $%d", len(args))
	}
	rows, err := db.Query(ctx, `SELECT w.id::text,coalesce(w.store_id::text,''),w.description,w.enabled,w.livemode,
   count(*) FILTER (WHERE d.status = 'failed'),count(*) FILTER (WHERE d.status = 'pending' AND NOT w.enabled),max(d.updated_at)
   FROM webhook_endpoints w JOIN webhook_deliveries d ON d.endpoint_id = w.id JOIN webhook_events e ON e.id = d.event_id
   LEFT JOIN invoices m ON m.id = e.invoice_id WHERE `+where+` AND (d.status = 'failed' OR d.status = 'pending' AND NOT w.enabled)
   GROUP BY w.id ORDER BY max(d.updated_at) DESC,w.id LIMIT $2`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[EndpointProblem])
}
