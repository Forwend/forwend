// Package priceapi serves the stablecoins' display prices of docs/backend/api.md (R-178).
package priceapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Prices are the same for everyone, so any signed-in user reads them, outside a profile.
func Routes(mux *http.ServeMux, g mid.Guards, pool *pgxpool.Pool) {
	mux.Handle("GET /v1/prices", g.SignedIn(listPrices(pool)))
}
