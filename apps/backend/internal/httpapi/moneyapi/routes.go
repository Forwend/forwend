package moneyapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/activity"
	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/balance"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/profile"
)

// R-108, R-110, R-112.
func Routes(mux *http.ServeMux, g mid.Guards, balances *balance.Service, activities *activity.Service,
	profiles *profile.Service) {
	mux.Handle("GET /v1/profiles/{profileId}/balances", g.Can(auth.MoneyRead)(getBalances(balances)))
	mux.Handle("GET /v1/profiles/{profileId}/balance-history", g.Can(auth.MoneyRead)(getBalanceHistory(balances)))
	mux.Handle("GET /v1/profiles/{profileId}/activity", g.Can(auth.MoneyRead)(getActivity(activities)))
	mux.Handle("GET /v1/profiles/{profileId}/transactions", g.Can(auth.MoneyRead)(getTransactions(activities)))
	mux.Handle("GET /v1/profiles/{profileId}/transactions.csv", g.Can(auth.MoneyRead)(getTransactionsCSV(activities)))
	mux.Handle("PUT /v1/profiles/{profileId}/transactions/{chainId}/{txHash}/{logIndex}/label",
		g.Can(auth.MoneyWrite)(putTransactionLabel(activities)))
	mux.Handle("GET /v1/profiles/{profileId}/records-currency", g.Can(auth.MoneyRead)(getRecordsCurrency(activities)))
	mux.Handle("PUT /v1/profiles/{profileId}/records-currency", g.Can(auth.MoneyWrite)(putRecordsCurrency(activities)))
	mux.Handle("GET /v1/profiles/{profileId}/statement.pdf", g.Can(auth.MoneyRead)(getStatement(activities, profiles)))
}
