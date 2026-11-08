package moneyapi

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"math/big"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/activity"
	"github.com/forwend/forwend/apps/backend/internal/document"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/profile"
)

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
		page, err := activities.List(r.Context(), r.PathValue("profileId"), query.Get("cursor"), limit, query.Get("status"), query.Get("state"), q)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := activityJSON{Items: []activityItemJSON{}}
		if page.NextCursor != "" {
			out.NextCursor = &page.NextCursor
		}
		for _, it := range page.Items {
			out.Items = append(out.Items, activityItemJSON{PaymentStatus: it.PaymentStatus, Confirming: it.Confirming, Kind: it.Kind, At: it.At.UTC().Format(time.RFC3339Nano),
				InvoiceID: it.InvoiceID, tokenJSON: toTokenJSON(it.Asset), Amount: it.Amount.String(),
				Status: it.Status, SettlementStatus: it.SettlementStatus, TxHash: it.TxHash, OptionCount: it.OptionCount,
				Closed: it.Closed, Held: it.Held, MerchantAmount: optionalAmount(it.MerchantAmount),
				HeldAmount: optionalAmount(it.HeldAmount), Purpose: it.Purpose, DocumentKind: it.DocumentKind, Number: it.Number,
				Reference: httpio.OrNull(it.Reference), ClientName: httpio.OrNull(it.ClientName), Title: httpio.OrNull(it.Title)})
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

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

// R-108.
var transactionsCSVHeader = []string{"Date (UTC)", "Direction", "Amount", "Token", "Network", "Counterparty",
	"Transaction", "Status", "USD value", "Classification", "Invoice", "Client"}

// R-108, R-118.
func getTransactionsCSV(activities *activity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		from, to, err := dayRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		var currency string
		var body bytes.Buffer
		out := csv.NewWriter(&body)
		out.UseCRLF = true
		var header []string
		err = activities.ExportTransfers(r.Context(), r.PathValue("profileId"), from, to, func(value string) error {
			currency = value
			header = slices.Clone(transactionsCSVHeader)
			if currency != "" {
				header = append(header, currency+" value", "ECB rate date")
			}
			header = append(header, "Payment ID")
			return out.Write(header)
		}, func(t activity.Transfer) error {
			invoice, client := "", ""
			if t.Invoice != nil {
				invoice, client = document.Number(t.Invoice.Number), t.Invoice.ClientName
			}
			row := make([]string, 0, len(header))
			row = append(row, t.At.Format(time.RFC3339), t.Direction, tokenAmount(t), t.Symbol,
				document.NetworkName(t.ChainID), t.Counterparty, t.TxHash, t.Status, t.USDValue().FloatString(t.Decimals),
				t.Classification(), invoice, client)
			if currency != "" {
				amount, day, ok := t.RecordsValue()
				if ok {
					row = append(row, amount, day.Format(time.DateOnly))
				} else {
					row = append(row, "", "")
				}
			}
			paymentID := ""
			if t.Payment != nil {
				paymentID = t.Payment.ID
			}
			row = append(row, paymentID)
			for i, cell := range row {
				row[i] = httpio.CSVText(cell)
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

func dayRange(from, to string) (time.Time, time.Time, error) {
	return httpio.DayRange(from, to)
}

// R-108.
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

// R-110.
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

// R-110.
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

// R-112, R-118.
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
		live := mid.ProfileAccess(r).Livemode
		s := document.Statement{Holder: holder.Issuer, From: from, To: to.AddDate(0, 0, -1),
			Issued: time.Now().UTC().Truncate(time.Second), Test: live != nil && !*live}
		err = activities.ExportTransfers(r.Context(), id, from, to, func(currency string) error {
			s.Currency = currency
			s.Decimals = invoice.AgreedCurrencies[currency]
			return nil
		}, func(t activity.Transfer) error {
			if t.Status != "confirmed" {
				return nil
			}
			switch t.Classification() {
			case activity.ClassInvoice, activity.ClassPayment, activity.LabelIncome:
				s.Lines = append(s.Lines, statementLine(t))
			case activity.ClassUnclassified, activity.ClassPaymentException:
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

func statementLine(t activity.Transfer) document.StatementLine {
	what := "Income"
	if t.Payment != nil {
		what = "Payment"
	}
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
