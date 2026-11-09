package checkoutapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
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
		var metadata map[string]string
		if len(body.Metadata) > 0 {
			if err := json.Unmarshal(body.Metadata, &metadata); err != nil {
				httpio.WriteError(w, r, fmt.Errorf("%w: metadata must be an object of text values", invoice.ErrInvalid))
				return
			}
		}
		lines := make([]invoice.LineRequest, 0, len(body.Items))
		for _, item := range body.Items {
			lines = append(lines, invoice.LineRequest{Description: item.Description, Quantity: item.Quantity, UnitPrice: item.UnitPrice})
		}
		inv, created, err := invoices.Create(r.Context(), r.PathValue("profileId"), key, invoice.Request{
			Purpose: invoice.PurposeCheckout, AmountUSD: body.AmountUSD, StoreID: body.StoreID, Livemode: access.Livemode,
			ExpiresInSeconds: body.ExpiresIn, Lines: lines, FeesPaidBy: body.FeesPaidBy,
			Details: invoice.Details{Title: body.Title, Reference: body.Reference, ReturnURL: body.ReturnURL,
				ClientName: body.Customer.Name, ClientEmail: body.Customer.Email, Metadata: metadata},
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
