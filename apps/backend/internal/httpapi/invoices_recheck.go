package httpapi

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
)

type recheckJSON struct {
	OnChain     string   `json:"onChain"`
	Recorded    string   `json:"recorded"`
	Rescanning  bool     `json:"rescanning"`
	NextCheckAt string   `json:"nextCheckAt"`
	Unreadable  []uint64 `json:"unreadable"`
}

// recheckInvoice is POST /v1/invoices/{invoiceId}/recheck (R-55): public like the checkout read, since the payer
// presses Check status. A check within invoice.RecheckEvery of the last one answers 429 with Retry-After.
func recheckInvoice(invoices *invoice.Service, balances ledger.BalanceOf) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		found, err := invoices.Recheck(r.Context(), r.PathValue("invoiceId"), balances)
		var soon *invoice.TooSoonError
		if errors.As(err, &soon) {
			w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(soon.Wait.Seconds())))))
			writeError(w, r, errRateLimited)
			return
		}
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, recheckJSON{OnChain: found.OnChain.String(), Recorded: found.Recorded.String(),
			Rescanning: found.Rescanning, NextCheckAt: found.NextAt.Format(time.RFC3339),
			Unreadable: append([]uint64{}, found.Unreadable...)})
	}
}
