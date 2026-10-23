package database

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Lock is a session advisory lock on its own connection: Postgres frees it when the connection ends, even on a crash.
type Lock struct{ conn *pgx.Conn }

func TakeLock(ctx context.Context, pool *pgxpool.Pool, key int64, name string, every time.Duration) (*Lock, error) {
	c, err := pool.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect for the %s lock: %w", name, err)
	}
	conn := c.Hijack() // out of the pool: the lock lives as long as this connection
	for {
		var got bool
		if err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", key).Scan(&got); err != nil {
			_ = conn.Close(context.Background())
			return nil, fmt.Errorf("take the %s lock: %w", name, err)
		}
		if got {
			return &Lock{conn}, nil
		}
		slog.Warn("another "+name+" is running; waiting", "retry", every)
		select {
		case <-ctx.Done():
			_ = conn.Close(context.Background())
			return nil, ctx.Err()
		case <-time.After(every):
		}
	}
}

// Held errors once the lock's connection is lost: another process may hold the lock now, so the caller must stop.
func (l *Lock) Held(ctx context.Context) error {
	if err := l.conn.Ping(ctx); err != nil {
		return fmt.Errorf("lost the advisory lock's database connection: %w", err)
	}
	return nil
}

func (l *Lock) Close() {
	_ = l.conn.Close(context.Background())
}
