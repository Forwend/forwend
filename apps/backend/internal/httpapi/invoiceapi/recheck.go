package invoiceapi

import (
	"net/http"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

func recheckInvoice(invoices *invoice.Service, balances ledger.BalanceOf, rechecks, owners *mid.Buckets) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		allow := func(owner string) time.Duration {
			if wait := owners.Wait(owner); wait > 0 {
				return wait
			}
			return rechecks.Wait(mid.Everyone(r))
		}
		found, err := invoices.Recheck(r.Context(), r.PathValue("payToken"), balances, allow)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, recheckJSON{OnChain: found.OnChain.String(), Recorded: found.Recorded.String(),
			Rescanning: found.Rescanning, NextCheckAt: found.NextAt.Format(time.RFC3339),
			Unreadable: append([]uint64{}, found.Unreadable...)})
	}
}
