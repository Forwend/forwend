package invoiceapi

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
)

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
		var repeat *invoice.Repeat
		if body.Repeat != nil {
			repeat = &invoice.Repeat{EndDate: body.Repeat.EndDate}
		}
		// R-138: a Developer or Finance member invoices for their own stores, the first one by default.
		if access := mid.ProfileAccess(r); access.Stores != nil {
			if body.StoreID == "" && len(access.Stores) > 0 {
				body.StoreID = access.Stores[0]
			}
			if !access.InStores(strings.ToLower(body.StoreID)) {
				httpio.WriteError(w, r, fmt.Errorf("%w: storeId must be one of the stores you work with", invoice.ErrInvalid))
				return
			}
		}
		inv, created, err := invoices.Create(r.Context(), r.PathValue("profileId"), key, invoice.Request{
			Lines:     lines,
			Agreed:    agreed,
			Reminders: body.Reminders,
			Repeat:    repeat,
			ChainID:   body.ChainID, Token: body.Token, Amount: body.Amount, AmountUSD: body.AmountUSD,
			ExpiresInSeconds: body.ExpiresIn,
			Details: invoice.Details{Title: body.Title, Note: body.Note, DueDate: body.DueDate, SupplyDate: body.SupplyDate,
				ClientName: body.Client.Name, ClientEmail: body.Client.Email, ClientAddress: body.Client.Address,
				ClientCountry: body.Client.Country, ClientTaxID: body.Client.TaxID,
				SenderName: body.SenderName, ReturnURL: body.ReturnURL, Reference: body.Reference},
			Replaces: body.Replaces,
			StoreID:  body.StoreID,
			Stores:   mid.ProfileAccess(r).Stores,
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
		page, err := invoices.List(r.Context(), r.PathValue("profileId"), query.Get("cursor"), limit, query.Get("status"), q,
			mid.ProfileAccess(r).Stores)
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

// Public: the pay link is the only key, so it leaves out the client's contact details but keeps the issuer.
func getInvoice(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.Get(r.Context(), r.PathValue("payToken"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toInvoiceDetailJSON(inv, false))
	}
}

// R-79.
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

// R-94, R-116.
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

// R-96.
func putReminders(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			On *bool `json:"on"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		if body.On == nil {
			httpio.WriteError(w, r, fmt.Errorf("%w: on must be true or false", invoice.ErrInvalid))
			return
		}
		inv, err := invoices.SetReminders(r.Context(), r.PathValue("profileId"), r.PathValue("invoiceId"), *body.On)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toOwnerInvoiceJSON(inv))
	}
}

// R-98.
func stopRepeat(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.StopRetainer(r.Context(), r.PathValue("profileId"), r.PathValue("invoiceId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toOwnerInvoiceJSON(inv))
	}
}

// R-96. It reads no body, so the mail provider's "List-Unsubscribe=One-Click" POST works too.
func stopReminders(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		number, from, err := invoices.StopReminders(r.Context(), r.PathValue("token"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, stoppedJSON{Number: number, From: httpio.OrNull(from)})
	}
}

// numbered keeps a link invoice from its owner's routes until its first deposit gives it a number (R-141).
func numbered(invoices *invoice.Service, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		unnumbered, err := invoices.Unnumbered(r.Context(), r.PathValue("invoiceId"))
		if err == nil && unnumbered {
			err = invoice.ErrNotFound
		}
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		next.ServeHTTP(w, r)
	})
}

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

// R-95.
func listOwed(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owed, err := invoices.Owed(r.Context(), r.PathValue("profileId"), mid.ProfileAccess(r).Stores)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := owedListJSON{Items: []owedJSON{}}
		for _, o := range owed {
			out.Items = append(out.Items, owedJSON{Kind: o.Kind, InvoiceID: o.InvoiceID, Number: o.Number,
				Title: httpio.OrNull(o.Title), ClientName: httpio.OrNull(o.ClientName), DueDate: httpio.OrNull(o.DueDate),
				DaysLate: o.DaysLate, OptionCount: o.OptionCount, ChainID: o.ChainID, Token: o.Token, Symbol: o.Symbol,
				Decimals: o.Decimals, Amount: o.Amount.String()})
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

// R-81.
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
		events, err := invoices.Events(r.Context(), r.PathValue("profileId"), limit, mid.ProfileAccess(r).Stores)
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

// R-82.
func putPayerEmail(invoices *invoice.Service, emails *mid.Buckets) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Email string `json:"email"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		allow := func() time.Duration { return emails.Wait(mid.Everyone(r)) }
		kept, err := invoices.SetPayerEmail(r.Context(), r.PathValue("payToken"), body.Email, allow)
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
		httpio.WriteJSON(w, http.StatusOK, map[string]string{"email": kept})
	}
}

// R-125.
func countView(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := invoices.CountView(r.Context(), r.PathValue("payToken")); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// R-127, R-128: the whole editable set; a missing, null or blank field clears it.
func putDetails(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Memo        string `json:"memo"`
			ClientEmail string `json:"clientEmail"`
			ReturnURL   string `json:"returnUrl"`
			Reference   string `json:"reference"`
			Note        string `json:"note"`
			DueDate     string `json:"dueDate"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		inv, err := invoices.Edit(r.Context(), r.PathValue("profileId"), r.PathValue("invoiceId"),
			invoice.Editable{Memo: body.Memo, ClientEmail: body.ClientEmail, ReturnURL: body.ReturnURL,
				Reference: body.Reference, Note: body.Note, DueDate: body.DueDate})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toOwnerInvoiceJSON(inv))
	}
}

// R-130.
func reopenInvoice(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.Reopen(r.Context(), r.PathValue("profileId"), r.PathValue("invoiceId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toOwnerInvoiceJSON(inv))
	}
}
