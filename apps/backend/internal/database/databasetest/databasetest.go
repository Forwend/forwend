// Package databasetest gives each test its own empty Postgres database.
package databasetest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/config"
	"github.com/jackc/pgx/v5"
)

// New creates an empty database next to DATABASE_URL and drops it when the test ends. Locally: pnpm postgres:up.
// The URL it returns has none of DATABASE_URL's pool_ parameters (pool_max_conns), which only pgxpool reads: tests
// also open plain connections, which would send them to Postgres as settings.
func New(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	raw, err := config.LoadDatabaseURL()
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	for k := range q {
		if strings.HasPrefix(k, "pool_") {
			q.Del(k)
		}
	}
	u.RawQuery = q.Encode()
	admin := u.String()
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Fatalf("connect to Postgres (locally: pnpm --filter @forwend/backend postgres:up): %v", err)
	}
	defer conn.Close(ctx)

	suffix := make([]byte, 6)
	_, _ = rand.Read(suffix)
	name := "test_" + hex.EncodeToString(suffix)
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		c, err := pgx.Connect(ctx, admin)
		if err != nil {
			t.Error(err)
			return
		}
		defer c.Close(ctx)
		if _, err := c.Exec(ctx, "DROP DATABASE "+name+" WITH (FORCE)"); err != nil {
			t.Error(err)
		}
	})

	u.Path = "/" + name
	return u.String()
}
