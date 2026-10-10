package balance

import (
	"context"
	"sync"
	"time"
)

// cache shares chain reads between the api's requests. get returns key's value while it is fresh. Otherwise it runs
// read once for every request that asks for key meanwhile, and keeps a successful value for ttl. An error goes to the
// requests that waited for that read and is not kept, so the next request reads again. Values are strings so that a
// Redis implementation can take memoryCache's place once the api runs as more than a few replicas
// (docs/backend/architecture.md#scaling).
type cache interface {
	get(ctx context.Context, key string, ttl time.Duration, read func(context.Context) (string, error)) (string, error)
}

type memoryCache struct {
	mu      sync.Mutex
	entries map[string]*entry
	swept   time.Time
}

// entry is in flight while expires is zero.
type entry struct {
	done    chan struct{}
	value   string
	err     error
	expires time.Time
}

func newMemoryCache() *memoryCache {
	return &memoryCache{entries: map[string]*entry{}}
}

func (m *memoryCache) get(ctx context.Context, key string, ttl time.Duration,
	read func(context.Context) (string, error)) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	now := time.Now()
	m.mu.Lock()
	e := m.entries[key]
	if e == nil || (!e.expires.IsZero() && now.After(e.expires)) {
		e = &entry{done: make(chan struct{})}
		m.entries[key] = e
		m.sweep(now)
		go m.fill(ctx, key, e, ttl, read)
	}
	m.mu.Unlock()
	select {
	case <-e.done:
		return e.value, e.err
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// fill runs the read for every request waiting on e. The request that started it may leave early while others still
// wait, so its cancel does not stop the read; its deadline still bounds it.
func (m *memoryCache) fill(ctx context.Context, key string, e *entry, ttl time.Duration,
	read func(context.Context) (string, error)) {
	shared := context.WithoutCancel(ctx)
	if deadline, ok := ctx.Deadline(); ok {
		var cancel context.CancelFunc
		shared, cancel = context.WithDeadline(shared, deadline)
		defer cancel()
	}
	value, err := read(shared)
	m.mu.Lock()
	e.value, e.err, e.expires = value, err, time.Now().Add(ttl)
	if err != nil && m.entries[key] == e {
		delete(m.entries, key)
	}
	m.mu.Unlock()
	close(e.done)
}

// sweep drops expired values at most once a minute, so the keys of past blocks don't pile up. Call it with mu held.
func (m *memoryCache) sweep(now time.Time) {
	if now.Sub(m.swept) < time.Minute {
		return
	}
	m.swept = now
	for k, e := range m.entries {
		if !e.expires.IsZero() && now.After(e.expires) {
			delete(m.entries, k)
		}
	}
}
