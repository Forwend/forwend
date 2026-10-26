package paymentapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/paymentio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

func get(invoices *invoice.Service, webURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.Payment(r.Context(), r.PathValue("profileId"), r.PathValue("paymentId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, paymentio.FromInvoice(inv, webURL))
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
			Stores: access.Stores, Livemode: access.Livemode,
		})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			Items      []paymentio.Payment `json:"items"`
			NextCursor *string             `json:"nextCursor"`
		}{Items: []paymentio.Payment{}, NextCursor: httpio.OrNull(page.NextCursor)}
		for _, inv := range page.Items {
			out.Items = append(out.Items, paymentio.FromInvoice(inv, webURL))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}
