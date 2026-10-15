package moneyapi

import (
	"net/http"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
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
			out.Items = append(out.Items, transactionJSON{tokenJSON: toTokenJSON(t.Asset), Direction: t.Direction,
				Amount: t.Amount.String(), Counterparty: t.Counterparty, TxHash: t.TxHash, LogIndex: t.LogIndex,
				BlockNumber: t.BlockNumber, At: t.At.Format(time.RFC3339), Status: t.Status})
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}
