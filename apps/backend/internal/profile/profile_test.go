package profile

import (
	"context"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/forwend/forwend/apps/backend/internal/privy/privytest"
	"github.com/jackc/pgx/v5/pgxpool"
)

const alice = "did:privy:alice"

func newService(t *testing.T) (*Service, *privytest.Fake, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	url := databasetest.Migrated(t, database.Migrate)
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	f := privytest.New(t)
	return NewService(pool, privy.NewClient(privytest.AppID, privytest.AppSecret, f.URL)), f, pool
}

func count(t *testing.T, pool *pgxpool.Pool, table string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
