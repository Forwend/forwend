package tests

import (
	"net/http"
	"reflect"
	"testing"
	"time"
)

// R-178.
func TestPrices(t *testing.T) {
	e := invoiceAPI(t)
	if r := e.call(t, "GET", "/v1/prices", "", "", ""); r.status != http.StatusUnauthorized || errorCode(r) != "unauthorized" {
		t.Fatalf("GET without a token: %d %v", r.status, r.body)
	}
	price := func(usd, source, fetched any, stale bool) map[string]any {
		return map[string]any{"chainId": float64(84532), "token": usdc, "symbol": "USDC", "coinId": "usd-coin",
			"usd": usd, "sourceUpdatedAt": source, "fetchedAt": fetched, "stale": stale}
	}
	// Bob's personal profile has no member role anywhere: any signed-in user reads them.
	if r := e.call(t, "GET", "/v1/prices", "did:privy:bob", "", ""); r.status != http.StatusOK ||
		!reflect.DeepEqual(r.body, map[string]any{"prices": []any{price(nil, nil, nil, true)}}) {
		t.Fatalf("GET before any read: %d %v", r.status, r.body)
	}
	fetched := time.Now().UTC().Truncate(time.Second)
	e.exec(t, `INSERT INTO coin_prices (coin_id, usd, source_updated_at, fetched_at) VALUES ('usd-coin', 0.999542, $1, $2)`,
		fetched.Add(-time.Minute), fetched)
	if r := e.call(t, "GET", "/v1/prices", "did:privy:alice", "", ""); r.status != http.StatusOK ||
		!reflect.DeepEqual(r.body, map[string]any{"prices": []any{price("0.999542",
			fetched.Add(-time.Minute).Format(time.RFC3339), fetched.Format(time.RFC3339), false)}}) {
		t.Fatalf("GET: %d %v", r.status, r.body)
	}
}
