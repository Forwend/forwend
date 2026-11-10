package database

import (
	"context"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
)

// A lock whose client vanished without a close must be freed in about a minute, not the two hours TCP takes by default.
func TestLockConnectionNoticesALostClientSoon(t *testing.T) {
	ctx := context.Background()
	pool, err := Open(ctx, databasetest.New(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	l, err := TakeLock(ctx, pool, 7, "test", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(l.Close)
	var idle string
	if err := l.conn.QueryRow(ctx, "SHOW tcp_keepalives_idle").Scan(&idle); err != nil || idle != "30" {
		t.Fatalf("lock session tcp_keepalives_idle %q (%v), want 30", idle, err)
	}
}
