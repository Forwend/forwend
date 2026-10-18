// Package ecb keeps the European Central Bank's daily euro reference rates (D-82), which records use to value a
// payment in a currency other than USD (R-110). The ECB publishes them on TARGET business days around 16:00 CET.
package ecb

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Every is how often the worker reads the rates again; Retry is the wait after a failed read.
const (
	Every = 6 * time.Hour
	Retry = 10 * time.Minute
)

// Rate is one currency's euro rate on one day: PerEUR units of Currency for 1 EUR, as the ECB writes it.
type Rate struct {
	Day      time.Time
	Currency string
	PerEUR   string
}

var (
	currencyCode = regexp.MustCompile(`^[A-Z]{3}$`)
	rateValue    = regexp.MustCompile(`^[0-9]{1,12}(\.[0-9]{1,12})?$`)
)

// envelope is the eurofxref file: a Cube of one Cube per day, each holding one Cube per currency.
type envelope struct {
	Days []struct {
		Time  string `xml:"time,attr"`
		Rates []struct {
			Currency string `xml:"currency,attr"`
			Rate     string `xml:"rate,attr"`
		} `xml:"Cube"`
	} `xml:"Cube>Cube"`
}

// Parse reads an ECB eurofxref file.
func Parse(r io.Reader) ([]Rate, error) {
	var e envelope
	if err := xml.NewDecoder(r).Decode(&e); err != nil {
		return nil, fmt.Errorf("parse ECB rates: %w", err)
	}
	var out []Rate
	for _, d := range e.Days {
		day, err := time.Parse(time.DateOnly, d.Time)
		if err != nil {
			return nil, fmt.Errorf("parse ECB rates: day %q", d.Time)
		}
		for _, c := range d.Rates {
			if !currencyCode.MatchString(c.Currency) || c.Currency == "EUR" || !rateValue.MatchString(c.Rate) {
				return nil, fmt.Errorf("parse ECB rates: %q %q on %q", c.Currency, c.Rate, d.Time)
			}
			out = append(out, Rate{Day: day, Currency: c.Currency, PerEUR: c.Rate})
		}
	}
	if len(out) == 0 {
		return nil, errors.New("parse ECB rates: no rates")
	}
	return out, nil
}

// Keeper reads the rates at URL when they are due and keeps them; the worker calls Tick each round.
type Keeper struct {
	Pool   *pgxpool.Pool
	Client *http.Client
	URL    string
	due    time.Time
}

// Tick reads the rates when due: again after Every, or after Retry when the read failed.
func (k *Keeper) Tick(ctx context.Context, now time.Time) error {
	if now.Before(k.due) {
		return nil
	}
	if err := k.refresh(ctx); err != nil {
		k.due = now.Add(Retry)
		return err
	}
	k.due = now.Add(Every)
	return nil
}

// refresh stores every rate in the file; a rate the ECB corrected replaces the one kept.
func (k *Keeper) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, k.URL, nil)
	if err != nil {
		return fmt.Errorf("read ECB rates: %w", err)
	}
	res, err := k.Client.Do(req)
	if err != nil {
		return fmt.Errorf("read ECB rates: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("read ECB rates: status %d", res.StatusCode)
	}
	rates, err := Parse(io.LimitReader(res.Body, 16<<20))
	if err != nil {
		return err
	}
	days, currencies, values := make([]string, len(rates)), make([]string, len(rates)), make([]string, len(rates))
	for i, r := range rates {
		days[i], currencies[i], values[i] = r.Day.Format(time.DateOnly), r.Currency, r.PerEUR
	}
	if _, err := k.Pool.Exec(ctx, `INSERT INTO ecb_rates (day, currency, per_eur)
		SELECT * FROM unnest($1::text[]::date[], $2::text[], $3::text[]::numeric[])
		ON CONFLICT (currency, day) DO UPDATE SET per_eur = excluded.per_eur`, days, currencies, values); err != nil {
		return fmt.Errorf("store ECB rates: %w", err)
	}
	return nil
}
