package database_test

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
)

func TestOpenNamesAnUnreachableDatabase(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	if _, err := database.Open(context.Background(), "postgres://forwend:x@"+addr+"/forwend?sslmode=disable"); err == nil ||
		!strings.Contains(err.Error(), "connect to Postgres") {
		t.Fatalf("got %v, want a Postgres connection error", err)
	}
}

func TestOpenRetainsCancellationCause(t *testing.T) {
	url := databasetest.New(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := database.Open(ctx, url)
	if !errors.Is(err, context.Canceled) || !strings.Contains(err.Error(), "connect to Postgres") {
		t.Fatalf("want connection context and cancellation, got %v", err)
	}
}

// Migrate runs first: its plain connection must not send pool_max_conns to Postgres as a setting.
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
