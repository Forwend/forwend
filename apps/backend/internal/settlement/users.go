package settlement

import (
	"context"
	"sync"
)

// User turns keep the sponsored limit atomic across chains, including the wait before a settle is saved.
type userTurns struct {
	mu    sync.Mutex
	users map[string]*userTurn
}

type userTurn struct {
	gate chan struct{}
	refs int
}

func (u *userTurns) take(ctx context.Context, id string) (func(), error) {
	u.mu.Lock()
	if u.users == nil {
		u.users = map[string]*userTurn{}
	}
	t := u.users[id]
	if t == nil {
		t = &userTurn{gate: make(chan struct{}, 1)}
		u.users[id] = t
	}
	t.refs++
	u.mu.Unlock()
	drop := func() {
		u.mu.Lock()
		defer u.mu.Unlock()
		t.refs--
		if t.refs == 0 {
			delete(u.users, id)
		}
	}
	select {
	case t.gate <- struct{}{}:
		return func() { <-t.gate; drop() }, nil
	case <-ctx.Done():
		drop()
		return nil, ctx.Err()
	}
}
