package ecb

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
)

const sample = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" ` +
	`xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><gesmes:subject>Reference rates</gesmes:subject>` +
	`<Cube><Cube time="2026-10-16"><Cube currency="USD" rate="1.1253"/><Cube currency="GBP" rate="0.84385"/></Cube>` +
	`<Cube time="2026-10-15"><Cube currency="USD" rate="1.12"/><Cube currency="GBP" rate="0.84"/></Cube></Cube>` +
	`</gesmes:Envelope>`

// The ECB's file: a day per Cube, a currency per Cube in it; anything else is refused whole.
func TestParse(t *testing.T) {
	rates, err := Parse(strings.NewReader(sample))
	if err != nil || len(rates) != 4 || rates[0].Currency != "USD" || rates[0].PerEUR != "1.1253" ||
		!rates[0].Day.Equal(time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)) || rates[3].Currency != "GBP" {
		t.Fatalf("rates %+v %v", rates, err)
	}
	for _, bad := range []string{
		`<Envelope><Cube></Cube></Envelope>`,
		strings.Replace(sample, `rate="1.12"`, `rate="1,12"`, 1),
		strings.Replace(sample, `currency="GBP" rate="0.84"`, `currency="EUR" rate="1"`, 1),
		strings.Replace(sample, `time="2026-10-15"`, `time="15.10.2026"`, 1),
		"not xml",
	} {
		if _, err := Parse(strings.NewReader(bad)); err == nil {
			t.Fatalf("parsed %q", bad)
		}
	}
}

// R-110: the worker reads the rates when due, keeps a corrected rate, and after a failure tries again after Retry.
func TestKeeperReadsWhenDue(t *testing.T) {
	ctx := context.Background()
	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	body, status, calls := sample, http.StatusOK, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	k := &Keeper{Pool: pool, Client: srv.Client(), URL: srv.URL}
	usd := func() string {
		t.Helper()
		var rate string
		if err := pool.QueryRow(ctx, "SELECT per_eur::text FROM ecb_rates WHERE currency = 'USD' AND day = '2026-10-16'").
			Scan(&rate); err != nil {
			t.Fatal(err)
		}
		return rate
	}
	now := time.Date(2026, 10, 16, 18, 0, 0, 0, time.UTC)
	tick := func(at time.Time, wantCalls int, wantErr bool) {
		t.Helper()
		if err := k.Tick(ctx, at); (err != nil) != wantErr || calls != wantCalls {
			t.Fatalf("tick at %s: %v, %d reads, want error %v and %d reads", at, err, calls, wantErr, wantCalls)
		}
	}
	tick(now, 1, false)
	var rows int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM ecb_rates").Scan(&rows); err != nil || rows != 4 || usd() != "1.1253" {
		t.Fatalf("stored %d rates, USD %s, %v", rows, usd(), err)
	}
	tick(now.Add(Every-time.Minute), 1, false)
	body = strings.Replace(sample, `rate="1.1253"`, `rate="1.13"`, 1)
	tick(now.Add(Every), 2, false)
	if usd() != "1.13" {
		t.Fatalf("the corrected rate %s, want 1.13", usd())
	}
	status = http.StatusServiceUnavailable
	failed := now.Add(2 * Every)
	tick(failed, 3, true)
	tick(failed.Add(Retry-time.Minute), 3, false)
	tick(failed.Add(Retry), 4, true)
}
