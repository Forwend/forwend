// Package healthapi answers whether the api can serve: 200 when the database answers.
package healthapi

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Routes mounts the health check, public, for the load balancer and the deploy check.
func Routes(mux *http.ServeMux, pool *pgxpool.Pool) {
	mux.HandleFunc("GET /healthz", health(pool))
}
