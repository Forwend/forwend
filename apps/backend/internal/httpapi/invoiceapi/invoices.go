package invoiceapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
)

// createInvoice is POST /v1/profiles/{profileId}/invoices: 201 when created, 200 when the same request is repeated.
func createInvoice(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, err := httpio.IdempotencyKey(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		var body createInvoiceBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		inv, created, err := invoices.Create(r.Context(), r.PathValue("profileId"), key, invoice.Request{
			ChainID: body.ChainID, Token: body.Token, Amount: body.Amount, AmountUSD: body.AmountUSD,
			ExpiresInSeconds: body.ExpiresIn,
			Details: invoice.Details{Title: body.Title, Note: body.Note, DueDate: body.DueDate,
				ClientName: body.Client.Name, ClientEmail: body.Client.Email, ClientAddress: body.Client.Address,
				SenderName: body.SenderName, ReturnURL: body.ReturnURL},
		})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toOwnerInvoiceJSON(inv))
	}
}

// listInvoices is GET /v1/profiles/{profileId}/invoices?limit=&cursor=&status=&q=.
func listInvoices(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpio.IntQuery(r, "limit", invoice.DefaultLimit)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		q, err := httpio.SearchQuery(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		query := r.URL.Query()
		page, err := invoices.List(r.Context(), r.PathValue("profileId"), query.Get("cursor"), limit, query.Get("status"), q)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := invoicesJSON{Items: []invoiceJSON{}}
		if page.NextCursor != "" {
			out.NextCursor = &page.NextCursor
		}
		for _, inv := range page.Items {
			out.Items = append(out.Items, toInvoiceJSON(inv, true))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

// getInvoice is GET /v1/invoices/{invoiceId}: public, so checkout can read the terms and recompute the address. The
// id is the only key, so it leaves out the client's contact details; the issuer is who bills the payer, so it stays.
func getInvoice(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.Get(r.Context(), r.PathValue("invoiceId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toInvoiceDetailJSON(inv, false))
	}
}

// cancelInvoice is POST /v1/profiles/{profileId}/invoices/{invoiceId}/cancel (R-79): 200 with the canceled invoice;
// 409 invoice_not_cancelable once money was seen, the checkout closed or the invoice is not open.
func cancelInvoice(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.Cancel(r.Context(), r.PathValue("profileId"), r.PathValue("invoiceId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toOwnerInvoiceJSON(inv))
	}
}

// getProfileInvoice is GET /v1/profiles/{profileId}/invoices/{invoiceId}: the public read with the client's details.
func getProfileInvoice(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.GetOfProfile(r.Context(), r.PathValue("profileId"), r.PathValue("invoiceId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toOwnerInvoiceJSON(inv))
	}
}
