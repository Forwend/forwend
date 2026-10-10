// Package database owns the Postgres pool and migrations.
package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ConnectTimeout bounds Open's first connection, so a database that does not answer stops the process at startup.
const ConnectTimeout = 10 * time.Second

func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("open Postgres pool: %w", err)
	}
	ping, cancel := context.WithTimeout(ctx, ConnectTimeout)
	defer cancel()
	if err := pool.Ping(ping); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to Postgres: %w", err)
	}
	return pool, nil
}
