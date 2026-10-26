package database_test

import (
	"context"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
)

func TestMigrateTwiceOnEmptyDatabase(t *testing.T) {
	url := databasetest.New(t)
	for i := range 2 {
		if err := database.Migrate(context.Background(), url); err != nil {
			t.Fatalf("run %d: %v", i+1, err)
		}
	}
}

func TestCheckSchemaRefusesAnOlderSchema(t *testing.T) {
	ctx := context.Background()
	url := databasetest.New(t)
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	older := func(when string) {
		t.Helper()
		if err := database.CheckSchema(ctx, pool); err == nil || !strings.Contains(err.Error(), "older than this binary") ||
			!strings.Contains(err.Error(), "start the api") {
			t.Fatalf("%s: got %v, want the schema refused", when, err)
		}
	}
	older("never migrated")
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	if err := database.CheckSchema(ctx, pool); err != nil {
		t.Fatalf("migrated: %v", err)
	}
	if _, err := pool.Exec(ctx, "DELETE FROM goose_db_version WHERE version_id = (SELECT max(version_id) FROM goose_db_version)"); err != nil {
		t.Fatal(err)
	}
	older("one migration short")
}
