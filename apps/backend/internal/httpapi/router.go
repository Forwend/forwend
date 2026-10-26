package httpapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
	"github.com/ensp1re/forwend/apps/backend/internal/apikey"
	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/balance"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/healthapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/invoiceapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/jobapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/keyapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/linkapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/moneyapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/profileapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/teamapi"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/webhookapi"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/job"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/link"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/ensp1re/forwend/apps/backend/internal/team"
	"github.com/ensp1re/forwend/apps/backend/internal/webhook"
	"github.com/jackc/pgx/v5/pgxpool"
)

// balances reads each chain's second RPC (D-15); webURL is the pay links' origin; userBurst 0 keeps mid.UserBurst;
// webhookKey seals webhook secrets, and nil leaves webhooks off (R-146).
func NewMux(pool *pgxpool.Pool, verifier *auth.Verifier, wallets *privy.Client, balances ledger.BalanceOf,
	webURL string, userBurst int, webhookKey []byte) http.Handler {
	keys := apikey.NewService(pool)
	guards := mid.NewGuards(verifier, auth.NewService(pool), keys, wallets, userBurst)
	mux := http.NewServeMux()
	healthapi.Routes(mux, pool)
	profiles := profile.NewService(pool, wallets)
	profileapi.Routes(mux, guards, profiles)
	invoices, hooks := invoice.NewService(pool), webhook.NewService(pool, webhookKey)
	invoiceapi.Routes(mux, guards, invoices, profiles, balances, webURL, hooks)
	jobapi.Routes(mux, guards, job.NewService(pool, invoices))
	moneyapi.Routes(mux, guards, balance.NewService(pool, balances), activity.NewService(pool), profiles)
	teamapi.Routes(mux, guards, team.NewService(pool, wallets))
	linkapi.Routes(mux, guards, link.NewService(pool, invoices))
	keyapi.Routes(mux, guards, keys)
	webhookapi.Routes(mux, guards, hooks)
	return mid.SecureHeaders(mux)
}
