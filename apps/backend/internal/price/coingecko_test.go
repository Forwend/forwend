package price

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5/pgxpool"
)

// An answer from the live API on 2026-10-28.
const sample = `{"usd-coin":{"usd":0.999542,"last_updated_at":1793212112},` +
	`"tether":{"usd":0.999169,"last_updated_at":1793212126},"open-usd":{"usd":0.999173,"last_updated_at":1793212112}}`

var ids = []string{"open-usd", "tether", "usd-coin"}

func TestParse(t *testing.T) {
	coins, err := Parse([]byte(sample), ids)
	want := []Coin{{"open-usd", "0.999173", time.Unix(1793212112, 0).UTC()},
		{"tether", "0.999169", time.Unix(1793212126, 0).UTC()}, {"usd-coin", "0.999542", time.Unix(1793212112, 0).UTC()}}
	if err != nil || !reflect.DeepEqual(coins, want) {
		t.Fatalf("coins %+v %v", coins, err)
	}
	// A coin missing or with a null price has none; the others stay.
	coins, err = Parse([]byte(`{"usd-coin":{"usd":1.000000000000000001,"last_updated_at":1},"tether":{"usd":null},`+
		`"origin-dollar":{"usd":0.99,"last_updated_at":1}}`), ids)
	if err != nil || len(coins) != 1 || coins[0].USD != "1.000000000000000001" {
		t.Fatalf("coins %+v %v", coins, err)
	}
	for _, bad := range []string{
		"not json",
		`[]`,
		`null`,
		`{}`,
		`{"status":{"error_code":429,"error_message":"rate limited"}}`,
		`{"usd-coin":{"usd":null}}`,
		`{"usd-coin":{"usd":"cheap","last_updated_at":1}}`,
		`{"usd-coin":{"usd":-1,"last_updated_at":1}}`,
		`{"usd-coin":{"usd":0,"last_updated_at":1}}`,
		`{"usd-coin":{"usd":0.000,"last_updated_at":1}}`,
		`{"usd-coin":{"usd":1e0,"last_updated_at":1}}`,
		`{"usd-coin":{"usd":1000000,"last_updated_at":1}}`,
		`{"usd-coin":{"usd":0.99}}`,
		`{"usd-coin":{"usd":0.99,"last_updated_at":0}}`,
		`{"usd-coin":{"usd":0.99,"last_updated_at":1.5}}`,
		strings.Replace(sample, "0.999169", "0.99,9", 1),
	} {
		if coins, err := Parse([]byte(bad), ids); err == nil {
			t.Fatalf("parsed %s as %+v", bad, coins)
		}
	}
}

func migrated(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	url := databasetest.Migrated(t, database.Migrate)
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestKeeperReadsWhenDue(t *testing.T) {
	ctx := context.Background()
	pool := migrated(t)
	body, status, calls := sample, http.StatusOK, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/api/v3/simple/price" || r.URL.Query().Get("ids") != "open-usd,tether,usd-coin" ||
			r.URL.Query().Get("vs_currencies") != "usd" || r.URL.Query().Get("include_last_updated_at") != "true" ||
			r.Header.Get("x-cg-demo-api-key") != "demo-key" {
			t.Errorf("request %s with key %q", r.URL, r.Header.Get("x-cg-demo-api-key"))
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	const every = 15 * time.Minute
	k := &Keeper{Pool: pool, Client: srv.Client(), URL: srv.URL + "/api/v3", Key: "demo-key", Every: every}
	stored := func() map[string]string {
		t.Helper()
		rows, err := pool.Query(ctx, "SELECT coin_id, usd::text || ' ' || to_char(fetched_at AT TIME ZONE 'UTC', 'HH24:MI') FROM coin_prices")
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]string{}
		for rows.Next() {
			var id, kept string
			if err := rows.Scan(&id, &kept); err != nil {
				t.Fatal(err)
			}
			out[id] = kept
		}
		return out
	}
	now := time.Date(2026, 10, 28, 10, 0, 0, 0, time.UTC)
	tick := func(at time.Time, wantCalls int, wantErr bool) {
		t.Helper()
		if err := k.Tick(ctx, at); (err != nil) != wantErr || calls != wantCalls {
			t.Fatalf("tick at %s: %v, %d reads, want error %v and %d reads", at, err, calls, wantErr, wantCalls)
		}
	}
	tick(now, 1, false)
	if got := stored(); !reflect.DeepEqual(got, map[string]string{"usd-coin": "0.999542 10:00",
		"tether": "0.999169 10:00", "open-usd": "0.999173 10:00"}) {
		t.Fatalf("stored %v", got)
	}
	tick(now.Add(every-time.Minute), 1, false)
	// Tether comes back null: its last price stays, with its old read time.
	body = `{"usd-coin":{"usd":1.0001,"last_updated_at":1793213000},"tether":{"usd":null},"open-usd":{"usd":0.9992,"last_updated_at":1793213000}}`
	tick(now.Add(every), 2, false)
	if got := stored(); !reflect.DeepEqual(got, map[string]string{"usd-coin": "1.0001 10:15",
		"tether": "0.999169 10:00", "open-usd": "0.9992 10:15"}) {
		t.Fatalf("stored %v", got)
	}

	failed := now.Add(2 * every)
	for _, answer := range []struct {
		status int
		body   string
	}{
		{http.StatusTooManyRequests, `{"status":{"error_code":429}}`},
		{http.StatusOK, sample + strings.Repeat(" ", maxAnswer)},
		{http.StatusOK, `{"usd-coin":{"usd":"free"}}`},
	} {
		status, body = answer.status, answer.body
		tick(failed, calls+1, true)
		tick(failed.Add(Retry-time.Second), calls, false)
		failed = failed.Add(Retry)
	}
	if got := stored(); got["usd-coin"] != "1.0001 10:15" {
		t.Fatalf("a failed read changed the prices: %v", got)
	}
	status, body = http.StatusOK, sample
	tick(failed, calls+1, false)
	tick(failed.Add(every-time.Second), calls, false)
}
