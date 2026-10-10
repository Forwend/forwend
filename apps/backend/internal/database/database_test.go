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

// A database that does not answer stops a binary at startup with a message naming Postgres.
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
