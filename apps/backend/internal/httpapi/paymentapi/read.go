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
		access := mid.ProfileAccess(r)
		detail, err := invoices.PaymentDetails(r.Context(), r.PathValue("profileId"), r.PathValue("paymentId"), invoice.PaymentQuery{Stores: access.Stores, Livemode: access.Livemode, Summary: r.URL.Query().Get("view") == "summary"})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toDetails(detail, webURL, access))
	}
}

func list(invoices *invoice.Service, webURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query, err := readQuery(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		page, err := invoices.Payments(r.Context(), r.PathValue("profileId"), query)
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

func readQuery(r *http.Request) (invoice.PaymentQuery, error) {
	limit, err := httpio.IntQuery(r, "limit", invoice.DefaultLimit)
	if err != nil {
		return invoice.PaymentQuery{}, err
	}
	search, err := httpio.SearchQuery(r)
	if err != nil {
		return invoice.PaymentQuery{}, err
	}
	access := mid.ProfileAccess(r)
	return invoice.PaymentQuery{Search: search, Limit: limit, Cursor: r.URL.Query().Get("cursor"), StoreID: r.URL.Query().Get("storeId"), LinkID: r.URL.Query().Get("linkId"),
		Source: invoice.PaymentSource(r.URL.Query().Get("source")), Status: r.URL.Query().Get("status"), PaymentStatus: r.URL.Query().Get("paymentStatus"),
		SettlementStatus: r.URL.Query().Get("settlementStatus"), RefundStatus: r.URL.Query().Get("refundStatus"), Stores: access.Stores, Livemode: access.Livemode}, nil
}
