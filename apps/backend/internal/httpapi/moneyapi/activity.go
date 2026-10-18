package moneyapi

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
	"github.com/ensp1re/forwend/apps/backend/internal/document"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
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

// transactionsCSVHeader names the export's columns (R-108).
var transactionsCSVHeader = []string{"Date (UTC)", "Direction", "Amount", "Token", "Network", "Counterparty",
	"Transaction", "Status", "USD value", "Classification", "Invoice", "Client"}

// getTransactionsCSV is GET /v1/profiles/{profileId}/transactions.csv?from=&to=: every transaction in those UTC days
// (both optional, inclusive), newest first (R-108).
func getTransactionsCSV(activities *activity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		from, to, err := dayRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		items, err := activities.AllTransfers(r.Context(), r.PathValue("profileId"), from, to)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="transactions.csv"`)
		out := csv.NewWriter(w)
		out.UseCRLF = true
		_ = out.Write(transactionsCSVHeader)
		for _, t := range items {
			invoice, client := "", ""
			if t.Invoice != nil {
				invoice, client = document.Number(t.Invoice.Number), t.Invoice.ClientName
			}
			row := []string{t.At.Format(time.RFC3339), t.Direction, tokenAmount(t), t.Symbol,
				document.NetworkName(t.ChainID), t.Counterparty, t.TxHash, t.Status, t.USDValue().FloatString(t.Decimals),
				t.Classification(), invoice, client}
			for i, cell := range row {
				// A spreadsheet runs a cell that starts like a formula; an apostrophe makes it text.
				if cell != "" && strings.ContainsRune("=+-@\t\r", rune(cell[0])) {
					row[i] = "'" + cell
				}
			}
			_ = out.Write(row)
		}
		out.Flush()
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
