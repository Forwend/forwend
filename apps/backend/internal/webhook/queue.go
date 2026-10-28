package webhook

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

const ManualPendingLimit = 32

var ErrQueueFull = errors.New("webhook pending queue is full")

func manualQueueRoom(ctx context.Context, tx pgx.Tx, profileID string) (int, error) {
	if _, err := tx.Exec(ctx, `INSERT INTO webhook_delivery_profiles(profile_id) VALUES($1) ON CONFLICT DO NOTHING`, profileID); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM webhook_delivery_profiles WHERE profile_id=$1 FOR UPDATE`, profileID); err != nil {
		return 0, err
	}
	var pending int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM (SELECT 1 FROM webhook_deliveries d
 JOIN webhook_endpoints e ON e.id=d.endpoint_id WHERE e.profile_id=$1 AND d.status='pending' LIMIT $2) q`,
		profileID, ManualPendingLimit).Scan(&pending)
	return ManualPendingLimit - pending, err
}
