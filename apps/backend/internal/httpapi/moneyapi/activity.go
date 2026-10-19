package moneyapi

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
	"github.com/ensp1re/forwend/apps/backend/internal/document"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

// getActivity is GET /v1/profiles/{profileId}/activity?limit=&cursor=&status=&q=.
func getActivity(activities *activity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpio.IntQuery(r, "limit", activity.DefaultLimit)
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
		page, err := activities.List(r.Context(), r.PathValue("profileId"), query.Get("cursor"), limit, query.Get("status"), q)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := activityJSON{Items: []activityItemJSON{}}
		if page.NextCursor != "" {
			out.NextCursor = &page.NextCursor
		}
		for _, it := range page.Items {
			out.Items = append(out.Items, activityItemJSON{Kind: it.Kind, At: it.At.UTC().Format(time.RFC3339Nano),
				InvoiceID: it.InvoiceID, tokenJSON: toTokenJSON(it.Asset), Amount: it.Amount.String(),
				Status: it.Status, SettlementStatus: it.SettlementStatus, TxHash: it.TxHash, OptionCount: it.OptionCount,
				Closed: it.Closed, Held: it.Held})
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

// getTransactions is GET /v1/profiles/{profileId}/transactions?limit=&cursor=&direction=&q=.
func getTransactions(activities *activity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpio.IntQuery(r, "limit", activity.DefaultLimit)
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
		page, err := activities.Transfers(r.Context(), r.PathValue("profileId"), query.Get("cursor"), limit,
			query.Get("direction"), q)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := transactionsJSON{Items: []transactionJSON{}}
		if page.NextCursor != "" {
			out.NextCursor = &page.NextCursor
		}
		for _, t := range page.Items {
			out.Items = append(out.Items, toTransactionJSON(t))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

// formulaAfterSemicolon is a formula start right after a ";", also after quotes: a cell that starts with a quote
// ends at the next lone quote, and what follows is added to it.
var formulaAfterSemicolon = regexp.MustCompile(`;("*[=+\-@\t\r])`)

// transactionsCSVHeader names the export's columns (R-108).
var transactionsCSVHeader = []string{"Date (UTC)", "Direction", "Amount", "Token", "Network", "Counterparty",
	"Transaction", "Status", "USD value", "Classification", "Invoice", "Client"}

// getTransactionsCSV is GET /v1/profiles/{profileId}/transactions.csv?from=&to=: every transaction in those UTC days
// (both optional, inclusive), newest first (R-108); 422 too_many_transactions past activity.MaxExportRows (R-118).
func getTransactionsCSV(activities *activity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		from, to, err := dayRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		currency, err := activities.RecordsCurrency(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		header := transactionsCSVHeader
		if currency != "" {
			header = append(slices.Clip(header), currency+" value", "ECB rate date")
		}
		// Rows go to the buffer as the database sends them, so the request holds the file, not every transfer.
		var body bytes.Buffer
		out := csv.NewWriter(&body)
		out.UseCRLF = true
		_ = out.Write(header)
		err = activities.EachTransfer(r.Context(), r.PathValue("profileId"), from, to, func(t activity.Transfer) error {
			invoice, client := "", ""
			if t.Invoice != nil {
				invoice, client = document.Number(t.Invoice.Number), t.Invoice.ClientName
			}
			row := []string{t.At.Format(time.RFC3339), t.Direction, tokenAmount(t), t.Symbol,
				document.NetworkName(t.ChainID), t.Counterparty, t.TxHash, t.Status, t.USDValue().FloatString(t.Decimals),
				t.Classification(), invoice, client}
			if currency != "" {
				amount, day, ok := t.RecordsValue()
				if ok {
					row = append(row, amount, day.Format(time.DateOnly))
				} else {
					row = append(row, "", "")
				}
			}
			for i, cell := range row {
				// A spreadsheet runs a cell that starts like a formula; an apostrophe makes it text. One that splits on
				// ";" (de-DE, fr-FR) starts a cell after each ";" too.
				if cell != "" && strings.ContainsRune("=+-@\t\r", rune(cell[0])) {
					cell = "'" + cell
				}
				if strings.Contains(cell, ";") { // only then: a regexp on every cell of a big export costs gigabytes
					cell = formulaAfterSemicolon.ReplaceAllString(cell, ";'$1")
				}
				row[i] = cell
			}
			return out.Write(row)
		})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out.Flush()
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="transactions.csv"`)
		_, _ = body.WriteTo(w)
	}
}

// dayRange reads the export's from and to UTC days (YYYY-MM-DD) as [from, the day after to).
func dayRange(from, to string) (time.Time, time.Time, error) {
	start, end := time.Unix(0, 0).UTC(), time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
	var err error
	if from != "" {
		if start, err = time.Parse(time.DateOnly, from); err != nil {
			return start, end, fmt.Errorf("%w: from must be a day like 2026-10-01", activity.ErrInvalid)
		}
	}
	if to != "" {
		if end, err = time.Parse(time.DateOnly, to); err != nil {
			return start, end, fmt.Errorf("%w: to must be a day like 2026-10-31", activity.ErrInvalid)
		}
		end = end.AddDate(0, 0, 1)
	}
	if !start.Before(end) {
		return start, end, fmt.Errorf("%w: from must not be after to", activity.ErrInvalid)
	}
	return start, end, nil
}

// putTransactionLabel is PUT /v1/profiles/{profileId}/transactions/{chainId}/{txHash}/{logIndex}/label with
// {"label": "income"|"own_transfer"|"refund"|"other"|null} (R-108).
func putTransactionLabel(activities *activity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Label *string `json:"label"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		// Postgres bigint: a larger number is no transfer.
		chainID, err := strconv.ParseUint(r.PathValue("chainId"), 10, 63)
		if err != nil {
			httpio.WriteError(w, r, activity.ErrNotFound)
			return
		}
		logIndex, err := strconv.ParseUint(r.PathValue("logIndex"), 10, 63)
		if err != nil {
			httpio.WriteError(w, r, activity.ErrNotFound)
			return
		}
		label := ""
		if body.Label != nil {
			label = *body.Label
		}
		if err := activities.SetLabel(r.Context(), r.PathValue("profileId"), chainID, r.PathValue("txHash"), logIndex,
			label); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type recordsCurrencyJSON struct {
	Currency *string `json:"currency"`
}

// getRecordsCurrency is GET /v1/profiles/{profileId}/records-currency (R-110).
func getRecordsCurrency(activities *activity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		currency, err := activities.RecordsCurrency(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, recordsCurrencyJSON{Currency: httpio.OrNull(currency)})
	}
}

// putRecordsCurrency is PUT /v1/profiles/{profileId}/records-currency with {"currency": "EUR"|...|null} (R-110).
func putRecordsCurrency(activities *activity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body recordsCurrencyJSON
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		currency := ""
		if body.Currency != nil {
			currency = *body.Currency
		}
		if err := activities.SetRecordsCurrency(r.Context(), r.PathValue("profileId"), currency); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, recordsCurrencyJSON{Currency: httpio.OrNull(currency)})
	}
}

// getStatement is GET /v1/profiles/{profileId}/statement.pdf?from=&to= (R-112): the profile's income in those UTC days,
// both required, as a PDF with the billing details as its account holder; 422 too_many_transactions past
// activity.MaxExportRows (R-118).
func getStatement(activities *activity.Service, profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q, id := r.URL.Query(), r.PathValue("profileId")
		if q.Get("from") == "" || q.Get("to") == "" {
			httpio.WriteError(w, r, fmt.Errorf("%w: from and to are both required", activity.ErrInvalid))
			return
		}
		from, to, err := dayRange(q.Get("from"), q.Get("to"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		holder, err := profiles.BillingDetails(r.Context(), id)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		currency, err := activities.RecordsCurrency(r.Context(), id)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		s := document.Statement{Holder: holder.Issuer, From: from, To: to.AddDate(0, 0, -1),
			Issued: time.Now().UTC().Truncate(time.Second), Currency: currency,
			Decimals: invoice.AgreedCurrencies[currency]}
		// Only income is kept; a transfer still confirming is no income yet.
		err = activities.EachTransfer(r.Context(), id, from, to, func(t activity.Transfer) error {
			if t.Status != "confirmed" {
				return nil
			}
			switch t.Classification() {
			case activity.ClassInvoice, activity.LabelIncome:
				s.Lines = append(s.Lines, statementLine(t))
			case activity.ClassUnclassified:
				s.Unclassified++
			}
			return nil
		})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		slices.Reverse(s.Lines) // oldest first
		pdf, err := document.StatementPDF(s)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="statement.pdf"`)
		_, _ = w.Write(pdf)
	}
}

// statementLine is an income transfer as a statement shows it: its USD value rounded half up to the cent, and its value
// in the records currency in minor units when it has a rate.
func statementLine(t activity.Transfer) document.StatementLine {
	what := "Income"
	if i := t.Invoice; i != nil {
		what = document.Number(i.Number)
		if i.ClientName != "" {
			what += " · " + i.ClientName
		}
	}
	// FloatString rounds halves away from zero, which for money in is half up; its digits are always an integer.
	cents, _ := new(big.Int).SetString(new(big.Rat).Mul(t.USDValue(), big.NewRat(100, 1)).FloatString(0), 10)
	l := document.StatementLine{At: t.At, What: what, ChainID: t.ChainID, TxHash: t.TxHash, USDCents: cents,
		Amount: document.Amount(t.Amount, t.Decimals, t.Symbol)}
	if amount, _, ok := t.RecordsValue(); ok {
		// The value is already rounded to the currency's decimals: without the point it is in minor units.
		l.Other, _ = new(big.Int).SetString(strings.Replace(amount, ".", "", 1), 10)
	}
	return l
}
