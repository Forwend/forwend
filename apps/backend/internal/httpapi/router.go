// Package httpapi is the api process's HTTP server. NewMux is the one place that mounts every module's routes behind
// the shared middleware; each module (healthapi, profileapi, invoiceapi, jobapi, moneyapi) lists its own routes in routes.go.
package httpapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/balance"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/healthapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/invoiceapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/jobapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/moneyapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/profileapi"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/job"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewMux serves the API. balances reads wallet balances from each chain's second RPC (D-15); webURL is the web app's
// origin, for the pay link in PDFs. userBurst is each signed-in user's burst; 0 keeps mid.UserBurst.
func NewMux(pool *pgxpool.Pool, verifier *auth.Verifier, wallets *privy.Client, balances ledger.BalanceOf,
	webURL string, userBurst int) http.Handler {
	guards := mid.NewGuards(verifier, auth.NewService(pool), userBurst)
	mux := http.NewServeMux()
	healthapi.Routes(mux, pool)
	profiles := profile.NewService(pool, wallets)
	profileapi.Routes(mux, guards, profiles)
	invoices := invoice.NewService(pool)
	invoiceapi.Routes(mux, guards, invoices, balances, webURL)
	jobapi.Routes(mux, guards, job.NewService(pool, invoices))
	moneyapi.Routes(mux, guards, balance.NewService(pool, balances), activity.NewService(pool), profiles)
	return mid.SecureHeaders(mux)
}
