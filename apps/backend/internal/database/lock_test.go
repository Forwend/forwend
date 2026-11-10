package database_test

import (
	"context"
	"log/slog"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Each worker has its own pool, as a separate process would.
func TestLockRunsOneWorkerAtATime(t *testing.T) {
	ctx := context.Background()
	url := databasetest.New(t)
	logs := &syncWriter{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	const key = 42
	var running atomic.Int32
	var overlap atomic.Bool
	type worker struct {
		stop   chan struct{}
		rounds atomic.Int32
		done   chan error
	}
	start := func() *worker {
		w := &worker{stop: make(chan struct{}), done: make(chan error, 1)}
		pool, err := database.Open(ctx, url)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(pool.Close)
		go func() {
			lock, err := database.TakeLock(ctx, pool, key, "worker", 10*time.Millisecond)
			if err != nil {
				w.done <- err
				return
			}
			defer lock.Close()
			for {
				select {
				case <-w.stop:
					w.done <- nil
					return
				default:
				}
				if err := lock.Held(ctx); err != nil {
					w.done <- err
					return
				}
				if running.Add(1) > 1 {
					overlap.Store(true)
				}
				time.Sleep(5 * time.Millisecond)
				running.Add(-1)
				w.rounds.Add(1)
			}
		}()
		return w
	}
	until := func(what string, ok func() bool) {
		t.Helper()
		for deadline := time.Now().Add(5 * time.Second); !ok(); time.Sleep(5 * time.Millisecond) {
			if time.Now().After(deadline) {
				t.Fatalf("timed out waiting for %s", what)
			}
		}
	}

	first := start()
	until("the first worker's rounds", func() bool { return first.rounds.Load() > 0 })
	second := start()
	until("the second worker to wait", func() bool { return strings.Contains(logs.String(), "another worker is running; waiting") })
	time.Sleep(100 * time.Millisecond)
	if n := second.rounds.Load(); n != 0 {
		t.Fatalf("the second worker ran %d rounds while the first holds the lock", n)
	}

	close(first.stop)
	if err := <-first.done; err != nil {
		t.Fatal(err)
	}
	until("the second worker to take over", func() bool { return second.rounds.Load() > 0 })
	if overlap.Load() {
		t.Fatal("two workers ran a round at the same time")
	}

	admin, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec(ctx, `SELECT pg_terminate_backend(pid) FROM pg_locks
		WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND granted`, key); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-second.done:
		if err == nil || !strings.Contains(err.Error(), "lost the advisory lock") {
			t.Fatalf("after its connection ended: %v, want the lock reported lost", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the worker kept running after its lock's connection ended")
	}
}

// A connection that stops answering without closing (a network break) is reported lost at once, not when TCP gives up
// hours later: until then no round starts.
func TestHeldGivesUpOnASilentConnection(t *testing.T) {
	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(databasetest.New(t))
	if err != nil {
		t.Fatal(err)
	}
	var silent atomic.Bool
	cfg.ConnConfig.DialFunc = func(ctx context.Context, network, addr string) (net.Conn, error) {
		c, err := (&net.Dialer{}).DialContext(ctx, network, addr)
		return silencedConn{c, &silent}, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	lock, err := database.TakeLock(ctx, pool, 43, "worker", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	silent.Store(true)
	done := make(chan error, 1)
	go func() { done <- lock.Held(ctx) }()
	select {
	case err := <-done:
		lock.Close()
		if err == nil || !strings.Contains(err.Error(), "lost the advisory lock") {
			t.Fatalf("on a silent connection: %v, want the lock reported lost", err)
		}
	case <-time.After(3 * database.LockPing):
		t.Fatal("Held still waits on a connection that stopped answering")
	}
}

// silencedConn drops what it is given to write once silent, so the server never answers: a half-open connection.
type silencedConn struct {
	net.Conn
	silent *atomic.Bool
}

func (c silencedConn) Write(b []byte) (int, error) {
	if c.silent.Load() {
		return len(b), nil
	}
	return c.Conn.Write(b)
}

type syncWriter struct {
	mu sync.Mutex
	b  strings.Builder
}

func (w *syncWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.b.Write(p)
}

func (w *syncWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.b.String()
}
