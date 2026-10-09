// Package httpapi holds the api process's HTTP routes.
package httpapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5/pgxpool"
)

func NewMux(pool *pgxpool.Pool, verifier *auth.Verifier, wallets *privy.Client) *http.ServeMux {
	owners, invoices, profiles := auth.NewService(pool), invoice.NewService(pool), profile.NewService(pool, wallets)
	signedIn := func(h http.Handler) http.Handler { return requireUser(verifier, h) }
	profileScoped := func(h http.Handler) http.Handler { return signedIn(requireProfileOwner(owners, h)) }

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", health(pool))
	mux.Handle("POST /v1/me", signedIn(signUp(profiles)))
	mux.Handle("GET /v1/me", signedIn(getMe(profiles)))
	mux.Handle("POST /v1/profiles", signedIn(createProfile(profiles)))
	mux.Handle("POST /v1/profiles/{profileId}/invoices", profileScoped(createInvoice(invoices)))
	mux.Handle("GET /v1/invoices/{invoiceId}", getInvoice(invoices)) // public: checkout reads
	return mux
}
