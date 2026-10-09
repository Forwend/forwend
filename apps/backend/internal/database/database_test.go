package database_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
)

func TestOpenRetainsCancellationCause(t *testing.T) {
	url := databasetest.New(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := database.Open(ctx, url)
	if !errors.Is(err, context.Canceled) || !strings.Contains(err.Error(), "connect to Postgres") {
		t.Fatalf("want connection context and cancellation, got %v", err)
	}
}
