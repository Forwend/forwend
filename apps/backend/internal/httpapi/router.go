package httpapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/activity"
	"github.com/forwend/forwend/apps/backend/internal/apikey"
	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/balance"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/checkoutapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/healthapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/invoiceapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/jobapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/keyapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/linkapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/moneyapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/paymentapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/priceapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/profileapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/reauthapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/sendapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/teamapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/webhookapi"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/job"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/link"
	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/forwend/forwend/apps/backend/internal/reauth"
	"github.com/forwend/forwend/apps/backend/internal/send"
	"github.com/forwend/forwend/apps/backend/internal/team"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
	"github.com/jackc/pgx/v5/pgxpool"
)

// balances reads each chain's RPC pool (D-15), and sendClients gives its clients (nil leaves sends unable to read a
// chain); webURL is the pay links' origin; userBurst 0 keeps mid.UserBurst;
// webhookKey seals webhook secrets, and nil leaves webhooks off (R-146); pricing gives new invoices their fees (R-227).
func NewMux(pool *pgxpool.Pool, verifier *auth.Verifier, wallets *privy.Client, balances ledger.BalanceOf,
	sendClients send.Clients, codes *reauth.Service, webURL string, userBurst int, webhookKey []byte,
	trustProxy bool, pricing invoice.Pricing) http.Handler {
	keys := apikey.NewService(pool)
	guards := mid.NewGuards(verifier, auth.NewService(pool), keys, wallets, codes, userBurst, trustProxy)
	mux := http.NewServeMux()
	healthapi.Routes(mux, pool)
	profiles := profile.NewService(pool, wallets)
	profileapi.Routes(mux, guards, profiles)
	invoices, hooks := invoice.NewService(pool), webhook.NewService(pool, webhookKey)
	invoices.SetPricing(pricing)
	invoiceapi.Routes(mux, guards, invoices, profiles, balances, webURL, hooks)
	checkoutapi.Routes(mux, guards, invoices, webURL)
	paymentapi.Routes(mux, guards, invoices, webURL)
	jobapi.Routes(mux, guards, job.NewService(pool, invoices))
	moneyapi.Routes(mux, guards, balance.NewService(pool, balances), activity.NewService(pool), profiles)
	sendapi.Routes(mux, guards, send.NewService(pool, sendClients, wallets))
	reauthapi.Routes(mux, guards, codes, wallets)
	teamapi.Routes(mux, guards, team.NewService(pool, wallets))
	linkapi.Routes(mux, guards, link.NewService(pool, invoices))
	keyapi.Routes(mux, guards, keys)
	webhookapi.Routes(mux, guards, hooks)
	priceapi.Routes(mux, guards, pool)
	return mid.SecureHeaders(mux)
}
