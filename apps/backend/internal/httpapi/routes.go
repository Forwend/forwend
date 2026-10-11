// Package httpapi holds the api process's HTTP routes.
package httpapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/balance"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewMux serves the API. balances reads wallet balances from each chain's second RPC (D-15); webURL is the web app's
// origin, for the pay link in PDFs.
func NewMux(pool *pgxpool.Pool, verifier *auth.Verifier, wallets *privy.Client, balances ledger.BalanceOf,
	webURL string) http.Handler {
	owners, invoices, profiles := auth.NewService(pool), invoice.NewService(pool), profile.NewService(pool, wallets)
	users := newBuckets(userRate, userBurst)
	signedIn := func(h http.Handler) http.Handler { return requireUser(verifier, limit(users, signedInUser, h)) }
	profileScoped := func(h http.Handler) http.Handler { return signedIn(requireProfileOwner(owners, h)) }

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", health(pool))
	mux.Handle("POST /v1/me", signedIn(signUp(profiles)))
	mux.Handle("GET /v1/me", signedIn(getMe(profiles)))
	mux.Handle("POST /v1/me/onboarding", signedIn(onboard(profiles)))
	mux.Handle("POST /v1/profiles", signedIn(createProfile(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/billing-details", profileScoped(putBillingDetails(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/billing-details", profileScoped(getBillingDetails(profiles)))
	mux.Handle("POST /v1/profiles/{profileId}/invoices", profileScoped(createInvoice(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices", profileScoped(listInvoices(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices/{invoiceId}", profileScoped(getProfileInvoice(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/balances", profileScoped(getBalances(balance.NewService(pool, balances))))
	mux.Handle("GET /v1/profiles/{profileId}/balance-history",
		profileScoped(getBalanceHistory(balance.NewService(pool, balances))))
	mux.Handle("GET /v1/profiles/{profileId}/activity", profileScoped(getActivity(activity.NewService(pool))))
	mux.Handle("GET /v1/profiles/{profileId}/transactions", profileScoped(getTransactions(activity.NewService(pool))))
	mux.Handle("GET /v1/invoices/{invoiceId}", getInvoice(invoices)) // checkout reads
	mux.Handle("GET /v1/invoices/{invoiceId}/invoice.pdf", invoicePDF(invoices, webURL))
	mux.Handle("GET /v1/invoices/{invoiceId}/receipt.pdf", receiptPDF(invoices, webURL))
	return secureHeaders(mux)
}

// Answers hold profile and billing data: no shared or browser cache keeps them unless a handler says otherwise.
func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}
