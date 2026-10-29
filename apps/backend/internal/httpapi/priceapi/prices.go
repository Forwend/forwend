package priceapi

import (
	"net/http"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/price"
	"github.com/jackc/pgx/v5/pgxpool"
)

func listPrices(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := price.List(r.Context(), pool, time.Now())
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := pricesJSON{Prices: []tokenPriceJSON{}}
		for _, p := range list {
			out.Prices = append(out.Prices, tokenPriceJSON{ChainID: p.ChainID, Token: p.Token, Symbol: p.Symbol,
				CoinID: httpio.OrNull(p.CoinID), USD: httpio.OrNull(p.USD), SourceUpdatedAt: httpio.OrNullTime(p.SourceUpdatedAt),
				FetchedAt: httpio.OrNullTime(p.FetchedAt), Stale: p.Stale})
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}
