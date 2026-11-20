package database_test

import (
	"context"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
)

func TestPoolSizeFromTheURL(t *testing.T) {
	ctx := context.Background()
	url := databasetest.New(t) + "&pool_max_conns=3"
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if got := pool.Config().MaxConns; got != 3 {
		t.Fatalf("pool of %d connections, want 3", got)
	}
}
