package job

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

func TestConcurrentCreatesRespectJobLimit(t *testing.T) {
	for _, sameKey := range []bool{false, true} {
		t.Run(fmt.Sprintf("same-key=%t", sameKey), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			pool, profileID := open(t)
			s := NewService(pool, invoice.NewService(pool))
			seed, _, err := s.Create(ctx, profileID, "seed", quote(false))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(ctx, `INSERT INTO jobs (profile_id,token,idempotency_key,request_hash,title,client_name,
		client_email,issuer_name,issuer_address,issuer_country,issuer_email)
		SELECT profile_id,lpad(n::text,64,'0'),'seed-'||n,request_hash,title,client_name,client_email,
		issuer_name,issuer_address,issuer_country,issuer_email FROM jobs CROSS JOIN generate_series(1,$2::int) n
		WHERE id=$1`, seed.ID, MaxJobs-2); err != nil {
				t.Fatal(err)
			}
			hold, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer hold.Rollback(context.Background())
			if _, err := hold.Exec(ctx, "SELECT 1 FROM profiles WHERE id=$1 FOR UPDATE", profileID); err != nil {
				t.Fatal(err)
			}
			results := make(chan error, 2)
			for i := range 2 {
				go func() {
					key := fmt.Sprintf("concurrent-%d", i)
					if sameKey {
						key = "concurrent"
					}
					_, _, err := s.Create(ctx, profileID, key, quote(false))
					results <- err
				}()
			}
			for {
				var waiting int
				if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity
			WHERE datname=current_database() AND wait_event_type='Lock'`).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting == 2 {
					break
				}
				time.Sleep(time.Millisecond)
			}
			if err := hold.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
			a, b := <-results, <-results
			if sameKey && (a != nil || b != nil) {
				t.Fatalf("concurrent replay at limit: %v, %v", a, b)
			}
			if !sameKey && !((a == nil && errors.Is(b, ErrInvalid)) || (b == nil && errors.Is(a, ErrInvalid))) {
				t.Fatalf("concurrent creates: %v, %v; want one success and one limit refusal", a, b)
			}
			var count int
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE profile_id=$1", profileID).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != MaxJobs {
				t.Fatalf("jobs: %d, want %d", count, MaxJobs)
			}
		})
	}
}
