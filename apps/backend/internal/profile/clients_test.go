package profile

import (
	"context"
	"errors"
	"testing"
	"time"
)

// With 999 clients and another save about to commit the 1000th, the next new client waits and is refused (R-86).
func TestSaveClientCapCountsASaveInFlight(t *testing.T) {
	s, _, pool := newService(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, alice); err != nil {
		t.Fatal(err)
	}
	var profileID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM profiles`).Scan(&profileID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO clients (profile_id, name)
		SELECT $1, 'filler ' || n FROM generate_series(1, $2::int) n`, profileID, MaxClients-1); err != nil {
		t.Fatal(err)
	}
	// Another save, as SaveClient makes it, holds the profile lock with the 1000th client not yet committed.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE", profileID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO clients (profile_id, name) VALUES ($1, 'in flight')`, profileID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, _, err := s.SaveClient(ctx, profileID, "33333333-3333-4333-8333-333333333333", ClientDetails{Name: "late"})
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("SaveClient finished while another save held the profile: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; !errors.Is(err, ErrInvalid) {
		t.Fatalf("the 1001st client: %v, want ErrInvalid", err)
	}
	if n := count(t, pool, "clients"); n != MaxClients {
		t.Fatalf("%d clients stored, want %d", n, MaxClients)
	}
}
