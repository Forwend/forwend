package checkoutapi

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/paymentio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

func create(invoices *invoice.Service, webURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, err := httpio.IdempotencyKey(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		var body createBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		body.StoreID = strings.ToLower(body.StoreID)
		access := mid.ProfileAccess(r)
		if body.StoreID == "" || !access.InStores(body.StoreID) {
			httpio.WriteError(w, r, fmt.Errorf("%w: storeId must name a store you work with", invoice.ErrInvalid))
			return
		}
		metadata, err := paymentio.Metadata(body.Metadata)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		inv, created, err := invoices.Create(r.Context(), r.PathValue("profileId"), key, invoice.Request{
			AmountUSD: body.AmountUSD, StoreID: body.StoreID, ExpiresInSeconds: body.ExpiresIn, Lines: paymentio.Lines(body.Items),
			FeesPaidBy: body.FeesPaidBy,
			Details: invoice.Details{Title: body.Title, Reference: body.Reference, ReturnURL: body.ReturnURL,
				ClientName: body.Customer.Name, ClientEmail: body.Customer.Email, Metadata: metadata},
			Caller: invoice.Caller{Purpose: invoice.PurposeCheckout, Livemode: access.Livemode},
		})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toJSON(inv, webURL))
	}
}
