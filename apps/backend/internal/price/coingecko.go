package price

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Retry is the wait after a failed read. maxAnswer bounds the answer, which for three coins is about 200 bytes.
const (
	Retry     = 2 * time.Minute
	maxAnswer = 64 << 10
)

// Coin is one coin's USD price, exactly as CoinGecko writes it, and when CoinGecko last updated it.
type Coin struct {
	ID        string
	USD       string
	UpdatedAt time.Time
}

var usdValue = regexp.MustCompile(`^[0-9]{1,6}(\.[0-9]{1,18})?$`)

// Parse reads a /simple/price answer for ids. A coin missing or with a null price has none this time. Any other
// price that is not a positive decimal with its update time fails the whole answer, and so does one without prices.
func Parse(answer []byte, ids []string) ([]Coin, error) {
	var coins map[string]struct {
		USD       *json.Number `json:"usd"`
		UpdatedAt *int64       `json:"last_updated_at"`
	}
	if err := json.Unmarshal(answer, &coins); err != nil {
		return nil, fmt.Errorf("parse CoinGecko prices: %w", err)
	}
	var out []Coin
	for _, id := range ids {
		c, ok := coins[id]
		if !ok || c.USD == nil {
			continue
		}
		usd := c.USD.String()
		if !usdValue.MatchString(usd) || strings.Trim(usd, "0.") == "" || c.UpdatedAt == nil || *c.UpdatedAt <= 0 {
			return nil, fmt.Errorf("parse CoinGecko prices: %s at %q", id, usd)
		}
		out = append(out, Coin{ID: id, USD: usd, UpdatedAt: time.Unix(*c.UpdatedAt, 0).UTC()})
	}
	if len(out) == 0 {
		return nil, errors.New("parse CoinGecko prices: no prices")
	}
	return out, nil
}

// Keeper reads the prices when due. URL is CoinGecko's API root; Key is the Demo plan's key, or "" to call without
// one: never log it.
type Keeper struct {
	Pool   *pgxpool.Pool
	Client *http.Client
	URL    string
	Key    string
	Every  time.Duration
	due    time.Time
}

func (k *Keeper) Tick(ctx context.Context, now time.Time) error {
	if now.Before(k.due) {
		return nil
	}
	if err := k.refresh(ctx, now); err != nil {
		k.due = now.Add(Retry)
		return err
	}
	k.due = now.Add(k.Every)
	return nil
}

// refresh keeps a coin's last price when this answer has none, so it turns stale instead of disappearing.
func (k *Keeper) refresh(ctx context.Context, now time.Time) error {
	ids := slices.Sorted(maps.Values(coinIDs))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		k.URL+"/simple/price?ids="+strings.Join(ids, ",")+"&vs_currencies=usd&include_last_updated_at=true", nil)
	if err != nil {
		return fmt.Errorf("read CoinGecko prices: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if k.Key != "" {
		req.Header.Set("x-cg-demo-api-key", k.Key)
	}
	res, err := k.Client.Do(req)
	if err != nil {
		return fmt.Errorf("read CoinGecko prices: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("read CoinGecko prices: status %d", res.StatusCode)
	}
	answer, err := io.ReadAll(io.LimitReader(res.Body, maxAnswer+1))
	if err != nil {
		return fmt.Errorf("read CoinGecko prices: %w", err)
	}
	if len(answer) > maxAnswer {
		return fmt.Errorf("read CoinGecko prices: answer over %d bytes", maxAnswer)
	}
	coins, err := Parse(answer, ids)
	if err != nil {
		return err
	}
	return k.store(ctx, coins, now)
}

func (k *Keeper) store(ctx context.Context, coins []Coin, now time.Time) error {
	got, usd, updated := make([]string, len(coins)), make([]string, len(coins)), make([]time.Time, len(coins))
	for i, c := range coins {
		got[i], usd[i], updated[i] = c.ID, c.USD, c.UpdatedAt
	}
	if _, err := k.Pool.Exec(ctx, `INSERT INTO coin_prices (coin_id, usd, source_updated_at, fetched_at)
		SELECT id, usd, updated, $4 FROM unnest($1::text[], $2::text[]::numeric[], $3::timestamptz[]) AS c (id, usd, updated)
		ON CONFLICT (coin_id) DO UPDATE SET usd = excluded.usd, source_updated_at = excluded.source_updated_at,
		    fetched_at = excluded.fetched_at`, got, usd, updated, now); err != nil {
		return fmt.Errorf("store CoinGecko prices: %w", err)
	}
	return nil
}
