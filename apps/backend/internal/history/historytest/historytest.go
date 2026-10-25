package historytest

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Events lists the history of option's invoice, oldest first, as "kind by actor" plus its data when it has any.
func Events(t *testing.T, db *pgxpool.Pool, option string) []string {
	t.Helper()
	rows, err := db.Query(context.Background(), `SELECT h.kind || ' by ' || h.actor ||
		    CASE WHEN h.data = '{}' THEN '' ELSE ' ' || h.data::text END
		FROM history_events h JOIN invoices i ON h.invoice_id = coalesce(i.main_id, i.id)
		WHERE i.id = $1 ORDER BY h.id`, option)
	if err != nil {
		t.Fatal(err)
	}
	events, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	return events
}

// Webhooks lists the webhook events of option's invoice in order (R-147): "sequence type", a held event's reason, and
// the descriptions of the endpoints it goes to, or none.
func Webhooks(t *testing.T, db *pgxpool.Pool, option string) []string {
	t.Helper()
	rows, err := db.Query(context.Background(), `SELECT e.sequence || ' ' || e.type ||
		    coalesce(' ' || (h.data->>'reason'), '') || ' to ' || coalesce((SELECT string_agg(w.description, ','
		        ORDER BY w.description) FROM webhook_deliveries d JOIN webhook_endpoints w ON w.id = d.endpoint_id
		        WHERE d.event_id = e.id), 'none')
		FROM webhook_events e JOIN history_events h ON h.id = e.history_id
		JOIN invoices i ON e.invoice_id = coalesce(i.main_id, i.id)
		WHERE i.id = $1 ORDER BY e.sequence`, option)
	if err != nil {
		t.Fatal(err)
	}
	events, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	return events
}
