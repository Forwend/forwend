package checkoutapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

func get(invoices *invoice.Service, webURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.Checkout(r.Context(), r.PathValue("profileId"), r.PathValue("sessionId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toJSON(inv, webURL))
	}
}

func list(invoices *invoice.Service, webURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpio.IntQuery(r, "limit", invoice.DefaultLimit)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		access := mid.ProfileAccess(r)
		page, err := invoices.Payments(r.Context(), r.PathValue("profileId"), invoice.PaymentQuery{
			Limit: limit, Cursor: r.URL.Query().Get("cursor"), StoreID: r.URL.Query().Get("storeId"),
			Purpose: invoice.PurposeCheckout, Stores: access.Stores, Livemode: access.Livemode,
		})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			Items      []sessionJSON `json:"items"`
			NextCursor *string       `json:"nextCursor"`
		}{Items: []sessionJSON{}, NextCursor: httpio.OrNull(page.NextCursor)}
		for _, inv := range page.Items {
			out.Items = append(out.Items, toJSON(inv, webURL))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

func expire(invoices *invoice.Service, webURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.ExpireCheckout(r.Context(), r.PathValue("profileId"), r.PathValue("sessionId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toJSON(inv, webURL))
	}
}
