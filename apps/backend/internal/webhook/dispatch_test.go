package webhook

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
)

func dispatchFixture(t *testing.T, count int) (*Service, []string, []string) {
	t.Helper()
	url := databasetest.Migrated(t, database.Migrate)
	pool, err := database.Open(t.Context(), url+"&pool_max_conns=4")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	s := NewService(pool, make([]byte, 32))
	var profiles, endpoints []string
	for n := range count {
		var profile string
		if err := pool.QueryRow(t.Context(), `WITH u AS (INSERT INTO users(privy_user_id) VALUES($1) RETURNING id)
 INSERT INTO profiles(user_id,kind) SELECT id,'freelancer' FROM u RETURNING id::text`, fmt.Sprint("did:privy:dispatch-", n)).Scan(&profile); err != nil {
			t.Fatal(err)
		}
		endpoint := fmt.Sprintf("00000000-0000-0000-0000-%012x", n+1)
		if _, _, err := s.Save(t.Context(), profile, fmt.Sprint("did:privy:dispatch-", n), endpoint, Details{URL: fmt.Sprintf("https://endpoint%d.example.com/hook", n), Events: []string{InvoicePaid}, Enabled: true}); err != nil {
			t.Fatal(err)
		}
		profiles = append(profiles, profile)
		endpoints = append(endpoints, endpoint)
	}
	return s, profiles, endpoints
}

type dispatchTransport func(*http.Request) (*http.Response, error)

func (f dispatchTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func delivered(r *http.Request) *http.Response {
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("ok")), Request: r}
}

func TestSlowWebhookTenantLeavesOtherProfilesCapacity(t *testing.T) {
	s, profiles, endpoints := dispatchFixture(t, 2)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	for range Batch {
		if _, err := s.SendTest(ctx, profiles[0], endpoints[0]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.SendTest(ctx, profiles[1], endpoints[1]); err != nil {
		t.Fatal(err)
	}
	fast := make(chan struct{}, 1)
	client := Client()
	client.Transport = dispatchTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "endpoint0.example.com" {
			<-r.Context().Done()
			return nil, r.Context().Err()
		}
		fast <- struct{}{}
		return delivered(r), nil
	})
	done := make(chan error, 1)
	go func() { done <- s.Deliver(ctx, client, nil) }()
	select {
	case <-fast:
	case <-time.After(3 * time.Second):
		t.Error("slow tenant occupied every sender slot")
	}
	cancel()
	<-done
}

func TestWebhookRunnerAcceptsNewProfilesDuringSlowAttempt(t *testing.T) {
	s, profiles, endpoints := dispatchFixture(t, 2)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	started, fast := make(chan struct{}, 1), make(chan struct{}, 1)
	client := Client()
	client.Transport = dispatchTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "endpoint0.example.com" {
			started <- struct{}{}
			<-r.Context().Done()
			return nil, r.Context().Err()
		}
		fast <- struct{}{}
		return delivered(r), nil
	})
	if _, err := s.SendTest(ctx, profiles[0], endpoints[0]); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { s.Run(ctx, client, nil); close(done) }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		cancel()
		<-done
		t.Fatal("slow attempt did not start")
	}
	if _, err := s.SendTest(ctx, profiles[1], endpoints[1]); err != nil {
		cancel()
		<-done
		t.Fatal(err)
	}
	select {
	case <-fast:
	case <-time.After(3 * time.Second):
		t.Error("new profile waited for another tenant's attempt")
	}
	cancel()
	<-done
}

func TestConcurrentWebhookManualQueueLimit(t *testing.T) {
	s, profiles, endpoints := dispatchFixture(t, 1)
	ctx := t.Context()
	for range ManualPendingLimit - 1 {
		if _, err := s.SendTest(ctx, profiles[0], endpoints[0]); err != nil {
			t.Fatal(err)
		}
	}
	results := make(chan error, 10)
	var callers sync.WaitGroup
	for range 10 {
		callers.Go(func() { _, err := s.SendTest(ctx, profiles[0], endpoints[0]); results <- err })
	}
	callers.Wait()
	close(results)
	accepted := 0
	for err := range results {
		if err == nil {
			accepted++
		} else if !errors.Is(err, ErrQueueFull) {
			t.Fatal(err)
		}
	}
	if accepted != 1 {
		t.Fatalf("accepted %d requests for one remaining queue slot", accepted)
	}
}

func TestWebhookClaimsRespectSharedConcurrency(t *testing.T) {
	s, profiles, endpoints := dispatchFixture(t, 1)
	ctx := t.Context()
	second, third := "00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003"
	for _, id := range []string{second, third} {
		if _, _, err := s.Save(ctx, profiles[0], "did:privy:dispatch-0", id, Details{URL: "https://" + id[len(id)-1:] + ".example.com/hook", Events: []string{InvoicePaid}, Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
	// Three endpoints, so the profile's limit of two is what stops a third lease.
	for _, endpoint := range []string{endpoints[0], second, third} {
		for range 4 {
			if _, err := s.SendTest(ctx, profiles[0], endpoint); err != nil {
				t.Fatal(err)
			}
		}
	}
	results := make(chan *delivery, 12)
	errorsSeen := make(chan error, 12)
	var callers sync.WaitGroup
	for range 12 {
		callers.Go(func() {
			other := NewService(s.pool, s.key)
			d, err := other.claim(ctx)
			if err != nil {
				errorsSeen <- err
			}
			if d != nil {
				results <- d
			}
		})
	}
	callers.Wait()
	close(results)
	close(errorsSeen)
	for err := range errorsSeen {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for d := range results {
		if seen[d.endpointID] {
			t.Fatal("endpoint leased more than once")
		}
		seen[d.endpointID] = true
	}
	if len(seen) == 0 || len(seen) > ProfileConcurrency {
		t.Fatalf("concurrent claims leased %d endpoints, want 1 to %d", len(seen), ProfileConcurrency)
	}
	// Claimers that found the profile locked skip it; later claims fill the free slots, and never more.
	for {
		d, err := NewService(s.pool, s.key).claim(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if d == nil {
			break
		}
		if seen[d.endpointID] {
			t.Fatal("endpoint leased more than once")
		}
		seen[d.endpointID] = true
	}
	if len(seen) != ProfileConcurrency {
		t.Fatalf("claimed %d endpoints, want %d", len(seen), ProfileConcurrency)
	}
}

func TestWebhookStaleAttemptCannotReleaseNewLease(t *testing.T) {
	s, profiles, endpoints := dispatchFixture(t, 1)
	ctx := t.Context()
	if _, err := s.SendTest(ctx, profiles[0], endpoints[0]); err != nil {
		t.Fatal(err)
	}
	old, err := s.claim(ctx)
	if err != nil || old == nil {
		t.Fatalf("claim: %v %v", old, err)
	}
	if _, err := s.pool.Exec(ctx, "UPDATE webhook_deliveries SET leased_until=now()-interval '1 second'"); err != nil {
		t.Fatal(err)
	}
	current, err := s.claim(ctx)
	if err != nil || current == nil {
		t.Fatalf("reclaim: %v %v", current, err)
	}
	if err := s.record(ctx, *old, 200, "", time.Millisecond); err != nil {
		t.Fatal(err)
	}
	var pending, owned bool
	if err := s.pool.QueryRow(ctx, "SELECT status='pending',leased_until=$1 FROM webhook_deliveries", current.leasedUntil).Scan(&pending, &owned); err != nil {
		t.Fatal(err)
	}
	if !pending || !owned {
		t.Fatal("stale completion changed newer attempt")
	}
	if err := s.record(ctx, *current, 200, "", time.Millisecond); err != nil {
		t.Fatal(err)
	}
	var state string
	if err := s.pool.QueryRow(ctx, "SELECT status FROM webhook_deliveries").Scan(&state); err != nil || state != "succeeded" {
		t.Fatalf("current attempt: %s %v", state, err)
	}
}

func TestExpiredWebhookLeaseCannotStartRequest(t *testing.T) {
	s, profiles, endpoints := dispatchFixture(t, 1)
	ctx := t.Context()
	if _, err := s.SendTest(ctx, profiles[0], endpoints[0]); err != nil {
		t.Fatal(err)
	}
	d, err := s.claim(ctx)
	if err != nil || d == nil {
		t.Fatalf("claim: %v %v", d, err)
	}
	d.leasedUntil = time.Now().Add(-time.Second)
	if _, err := s.pool.Exec(ctx, "UPDATE webhook_deliveries SET leased_until=$1", d.leasedUntil); err != nil {
		t.Fatal(err)
	}
	called := false
	client := Client()
	client.Transport = dispatchTransport(func(r *http.Request) (*http.Response, error) { called = true; return delivered(r), nil })
	if err := s.attempt(ctx, client, nil, *d); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expired attempt: %v", err)
	}
	if called {
		t.Fatal("expired lease started a network request")
	}
}

func TestWebhookProfilesRotateWithPersistentBacklogs(t *testing.T) {
	s, profiles, endpoints := dispatchFixture(t, Batch+4)
	for n := range profiles {
		for range 3 {
			if _, err := s.SendTest(t.Context(), profiles[n], endpoints[n]); err != nil {
				t.Fatal(err)
			}
		}
	}
	for range 2 {
		seen := map[string]bool{}
		for range len(profiles) {
			d, err := s.claim(t.Context())
			if err != nil || d == nil {
				t.Fatalf("claim: %v %v", d, err)
			}
			if seen[d.profileID] {
				t.Fatal("busy profile starved another profile")
			}
			seen[d.profileID] = true
			if err := s.record(t.Context(), *d, 200, "", time.Millisecond); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestWebhookBulkResendUsesAvailableQueueCapacity(t *testing.T) {
	s, profiles, endpoints := dispatchFixture(t, 1)
	ctx := t.Context()
	for range ManualPendingLimit {
		if _, err := s.SendTest(ctx, profiles[0], endpoints[0]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.pool.Exec(ctx, "UPDATE webhook_deliveries SET status='failed'"); err != nil {
		t.Fatal(err)
	}
	for range 8 {
		if _, err := s.SendTest(ctx, profiles[0], endpoints[0]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.pool.Exec(ctx, "UPDATE webhook_deliveries SET status='failed'"); err != nil {
		t.Fatal(err)
	}
	queued, err := s.ResendFailed(ctx, profiles[0], endpoints[0], time.Now().Add(-time.Hour))
	if err != nil || queued != ManualPendingLimit {
		t.Fatalf("queued=%d: %v", queued, err)
	}
	var failed string
	if err := s.pool.QueryRow(ctx, "SELECT event_id FROM webhook_deliveries WHERE status='failed' LIMIT 1").Scan(&failed); err != nil {
		t.Fatal(err)
	}
	if err := s.Resend(ctx, profiles[0], endpoints[0], failed); !errors.Is(err, ErrQueueFull) {
		t.Fatalf("resend over budget: %v", err)
	}
}
