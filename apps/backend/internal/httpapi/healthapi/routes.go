package healthapi

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Public: the load balancer and the deploy check call it.
func Routes(mux *http.ServeMux, pool *pgxpool.Pool) {
	mux.HandleFunc("GET /healthz", health(pool))
}
