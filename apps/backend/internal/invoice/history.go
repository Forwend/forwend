package invoice

import (
	"context"
	"fmt"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

// HistoryEvent is one row of the invoice's history (R-123).
type HistoryEvent struct {
	ID    int64
	Kind  string
	Actor history.Actor
	At    time.Time
	history.Data
}

func (s *Service) history(ctx context.Context, id string) ([]HistoryEvent, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, kind, actor, at, data FROM history_events WHERE invoice_id = $1
		ORDER BY id DESC`, id)
	if err != nil {
		return nil, fmt.Errorf("read invoice %s history: %w", id, err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (HistoryEvent, error) {
		var e HistoryEvent
		err := row.Scan(&e.ID, &e.Kind, &e.Actor, &e.At, &e.Data)
		return e, err
	})
}
