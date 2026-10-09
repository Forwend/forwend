// Package httpapi holds the api process's HTTP routes.
package httpapi

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewMux(pool *pgxpool.Pool) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", health(pool))
	return mux
}
