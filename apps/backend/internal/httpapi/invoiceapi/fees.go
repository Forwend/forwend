package invoiceapi

import (
	"net/http"
	"strconv"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

type feesJSON struct {
	FeesPaidBy string          `json:"feesPaidBy"`
	Options    []feeOptionJSON `json:"options"`
}

type feeOptionJSON struct {
	ChainID     uint64 `json:"chainId"`
	Token       string `json:"token"`
	Decimals    int    `json:"decimals"`
	Price       string `json:"price"`
	NetworkFee  string `json:"networkFee"`
	PlatformFee string `json:"platformFee"`
}

// R-227: the fees a new invoice of a price would carry on each option, and who pays them by default, so a form shows
// what the client pays and what the owner receives before it saves. ?chainId, token and amount, or ?amountUsd.
func getFees(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		chainID, _ := strconv.ParseUint(q.Get("chainId"), 10, 64)
		paidBy, quotes, err := invoices.QuoteFees(r.Context(), r.PathValue("profileId"), invoice.Request{ChainID: chainID,
			Token: q.Get("token"), Amount: q.Get("amount"), AmountUSD: q.Get("amountUsd")})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := feesJSON{FeesPaidBy: paidBy, Options: []feeOptionJSON{}}
		for _, o := range quotes {
			out.Options = append(out.Options, feeOptionJSON{ChainID: o.ChainID, Token: o.Token, Decimals: o.Decimals,
				Price: o.Price.String(), NetworkFee: o.NetworkFee.String(), PlatformFee: o.PlatformFee.String()})
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}
