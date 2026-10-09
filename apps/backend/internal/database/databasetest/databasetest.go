// Package databasetest gives each test its own empty Postgres database.
package databasetest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/config"
	"github.com/jackc/pgx/v5"
)

// New creates an empty database next to DATABASE_URL and drops it when the test ends. Locally: pnpm postgres:up.
func New(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	cfg, err := config.LoadWorker()
	if err != nil {
		t.Fatal(err)
	}
	admin := cfg.DatabaseURL
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

	u, err := url.Parse(admin)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	return u.String()
}
