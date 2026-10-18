// Package moneyapi serves a profile's money reads: balances, balance history, activity and wallet transactions.
package moneyapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
	"github.com/ensp1re/forwend/apps/backend/internal/balance"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
)

// Routes mounts a profile's money reads on mux: balances and their history, activity and wallet transactions.
func Routes(mux *http.ServeMux, g mid.Guards, balances *balance.Service, activities *activity.Service) {
	mux.Handle("GET /v1/profiles/{profileId}/balances", g.ProfileScoped(getBalances(balances)))
	mux.Handle("GET /v1/profiles/{profileId}/balance-history", g.ProfileScoped(getBalanceHistory(balances)))
	mux.Handle("GET /v1/profiles/{profileId}/activity", g.ProfileScoped(getActivity(activities)))
	mux.Handle("GET /v1/profiles/{profileId}/transactions", g.ProfileScoped(getTransactions(activities)))
	mux.Handle("GET /v1/profiles/{profileId}/transactions.csv", g.ProfileScoped(getTransactionsCSV(activities)))
	mux.Handle("PUT /v1/profiles/{profileId}/transactions/{chainId}/{txHash}/{logIndex}/label",
		g.ProfileScoped(putTransactionLabel(activities)))
}
