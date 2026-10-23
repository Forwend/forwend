package database

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

//go:embed migrations/*.sql
var migrations embed.FS

// The session lock lets several processes start and migrate at once.
func Migrate(ctx context.Context, url string) error {
	// Parsed as the pool parses it, so its pool_ parameters (pool_max_conns) are not sent to Postgres as settings.
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return fmt.Errorf("open migration connection: %w", err)
	}
	conn := stdlib.OpenDB(*config.ConnConfig)
	defer conn.Close()
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return fmt.Errorf("read embedded migrations: %w", err)
	}
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return fmt.Errorf("create migration lock: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, conn, files, goose.WithSessionLocker(locker))
	if err != nil {
		return fmt.Errorf("prepare migrations: %w", err)
	}
	_, err = provider.Up(ctx)
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}

// CheckSchema errors unless every embedded migration is applied. Only the api migrates: the worker and signer call
// this at startup so they never run against an older schema.
func CheckSchema(ctx context.Context, pool *pgxpool.Pool) error {
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("read embedded migrations: %w", err)
	}
	versions := make([]int64, 0, len(names))
	for _, name := range names {
		v, err := goose.NumericComponent(name)
		if err != nil {
			return fmt.Errorf("read embedded migrations: %w", err)
		}
		versions = append(versions, v)
	}
	var applied int
	err = pool.QueryRow(ctx, `SELECT count(DISTINCT version_id) FROM goose_db_version WHERE version_id = ANY($1)`,
		versions).Scan(&applied)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "42P01" { // undefined_table: never migrated
		err = nil
	}
	if err != nil {
		return fmt.Errorf("read the database schema version: %w", err)
	}
	if applied < len(versions) {
		return fmt.Errorf("the database schema is older than this binary (%d of %d migrations applied): "+
			"start the api first, it applies them", applied, len(versions))
	}
	return nil
}
