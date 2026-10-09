package database

import (
	"context"
	"database/sql"
	"io/fs"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/pressly/goose/v3"
)

// Every Down section must undo its Up, so a migration can be rolled back and applied again.
func TestMigrationsRollBackAndReapply(t *testing.T) {
	ctx := context.Background()
	conn, err := sql.Open("pgx", databasetest.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, conn, files)
	if err != nil {
		t.Fatal(err)
	}
	for _, step := range []func(context.Context) error{
		func(ctx context.Context) error { _, err := provider.Up(ctx); return err },
		func(ctx context.Context) error { _, err := provider.DownTo(ctx, 0); return err },
		func(ctx context.Context) error { _, err := provider.Up(ctx); return err },
	} {
		if err := step(ctx); err != nil {
			t.Fatal(err)
		}
	}
}
