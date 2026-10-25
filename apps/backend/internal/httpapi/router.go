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
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/teamapi"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/job"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/ensp1re/forwend/apps/backend/internal/team"
	"github.com/jackc/pgx/v5/pgxpool"
)

// balances reads each chain's second RPC (D-15); webURL is the pay links' origin; userBurst 0 keeps mid.UserBurst.
func NewMux(pool *pgxpool.Pool, verifier *auth.Verifier, wallets *privy.Client, balances ledger.BalanceOf,
	webURL string, userBurst int) http.Handler {
	guards := mid.NewGuards(verifier, auth.NewService(pool), wallets, userBurst)
	mux := http.NewServeMux()
	healthapi.Routes(mux, pool)
	profiles := profile.NewService(pool, wallets)
	profileapi.Routes(mux, guards, profiles)
	invoices := invoice.NewService(pool)
	invoiceapi.Routes(mux, guards, invoices, profiles, balances, webURL)
	jobapi.Routes(mux, guards, job.NewService(pool, invoices))
	moneyapi.Routes(mux, guards, balance.NewService(pool, balances), activity.NewService(pool), profiles)
	teamapi.Routes(mux, guards, team.NewService(pool, wallets))
	return mid.SecureHeaders(mux)
}
