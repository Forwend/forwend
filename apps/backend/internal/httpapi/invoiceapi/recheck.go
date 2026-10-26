package invoiceapi

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

// Public (R-55): the payer presses Check status.
func recheckInvoice(invoices *invoice.Service, balances ledger.BalanceOf, rechecks, owners *mid.Buckets) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		allow := func(owner string) time.Duration {
			if wait := owners.Wait(owner); wait > 0 {
				return wait
			}
			return rechecks.Wait(mid.Everyone(r))
		}
		found, err := invoices.Recheck(r.Context(), r.PathValue("payToken"), balances, allow)
		var soon *invoice.TooSoonError
		if errors.As(err, &soon) {
			w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(soon.Wait.Seconds())))))
			httpio.WriteError(w, r, httpio.ErrRateLimited)
			return
		}
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, recheckJSON{OnChain: found.OnChain.String(), Recorded: found.Recorded.String(),
			Rescanning: found.Rescanning, NextCheckAt: found.NextAt.Format(time.RFC3339),
			Unreadable: append([]uint64{}, found.Unreadable...)})
	}
}
