package database_test

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
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
