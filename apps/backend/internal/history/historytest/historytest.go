// Package historytest reads invoice histories in tests.
package historytest

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Events lists the history of the invoice that option belongs to, oldest first, as "kind by actor", followed by its
// data when it has any.
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
