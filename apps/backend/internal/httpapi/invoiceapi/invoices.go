package invoiceapi

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
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
		lines := make([]invoice.LineRequest, 0, len(body.Lines))
		for _, l := range body.Lines {
			lines = append(lines, invoice.LineRequest{Description: l.Description, Quantity: l.Quantity,
				UnitPrice: l.UnitPrice})
		}
		var agreed *invoice.AgreedRequest
		if a := body.AgreedValue; a != nil {
			agreed = &invoice.AgreedRequest{Currency: a.Currency, Amount: a.Amount, Date: a.Date}
		}
		inv, created, err := invoices.Create(r.Context(), r.PathValue("profileId"), key, invoice.Request{
			Lines:   lines,
			Agreed:  agreed,
			ChainID: body.ChainID, Token: body.Token, Amount: body.Amount, AmountUSD: body.AmountUSD,
			ExpiresInSeconds: body.ExpiresIn,
			Details: invoice.Details{Title: body.Title, Note: body.Note, DueDate: body.DueDate, SupplyDate: body.SupplyDate,
				ClientName: body.Client.Name, ClientEmail: body.Client.Email, ClientAddress: body.Client.Address,
				ClientCountry: body.Client.Country, ClientTaxID: body.Client.TaxID,
				SenderName: body.SenderName, ReturnURL: body.ReturnURL, Reference: body.Reference},
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

// sendInvoice is POST /v1/profiles/{profileId}/invoices/{invoiceId}/send (R-94): queues the invoice's email to its
// client; 201 with the invoice, 200 when the same Idempotency-Key already queued it. 409 client_email_required or
// invoice_closed; 429 with Retry-After within invoice.SendEvery of the invoice's last send, past the profile's
// invoice.MaxProfileSends, or past the shared emails budget.
func sendInvoice(invoices *invoice.Service, emails *mid.Buckets) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, err := httpio.IdempotencyKey(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		allow := func() time.Duration { return emails.Wait(mid.Everyone(r)) }
		inv, queued, err := invoices.Send(r.Context(), r.PathValue("profileId"), r.PathValue("invoiceId"), key, allow)
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
		status := http.StatusOK
		if queued {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toOwnerInvoiceJSON(inv))
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

// listEvents is GET /v1/profiles/{profileId}/events?limit= (R-81): the bell's paid, settled and held-money events,
// newest first.
func listEvents(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := invoice.MaxEvents
		if v := r.URL.Query().Get("limit"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil {
				httpio.WriteError(w, r, fmt.Errorf("%w: limit must be a number", invoice.ErrInvalid))
				return
			}
			limit = n
		}
		events, err := invoices.Events(r.Context(), r.PathValue("profileId"), limit)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := eventsJSON{Items: []eventJSON{}}
		for _, e := range events {
			out.Items = append(out.Items, eventJSON{ID: e.ID, Kind: e.Kind, InvoiceID: e.InvoiceID, Number: e.Number,
				ChainID: e.ChainID, Token: e.Token, Symbol: e.Symbol, Decimals: e.Decimals, Amount: e.Amount.String(),
				At: e.At.UTC().Format(time.RFC3339Nano)})
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

// putPayerEmail is PUT /v1/invoices/{invoiceId}/payer-email (R-82): public, like the checkout. 200 with the address as
// kept; 409 receipt_sent once the receipt went out.
func putPayerEmail(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Email string `json:"email"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		kept, err := invoices.SetPayerEmail(r.Context(), r.PathValue("invoiceId"), body.Email)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, map[string]string{"email": kept})
	}
}
