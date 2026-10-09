// Package httpapi holds the api process's HTTP routes.
package httpapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/jackc/pgx/v5/pgxpool"
)

func NewMux(pool *pgxpool.Pool, verifier *auth.Verifier) *http.ServeMux {
	owners, invoices := auth.NewService(pool), invoice.NewService(pool)
	profileScoped := func(h http.Handler) http.Handler { return requireUser(verifier, requireProfileOwner(owners, h)) }

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", health(pool))
	mux.Handle("POST /v1/profiles/{profileId}/invoices", profileScoped(createInvoice(invoices)))
	mux.Handle("GET /v1/invoices/{invoiceId}", getInvoice(invoices)) // public: checkout reads
	return mux
}
