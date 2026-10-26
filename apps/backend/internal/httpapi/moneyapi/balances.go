package moneyapi

import (
	"net/http"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/balance"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
)

func getBalances(balances *balance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		b, err := balances.Of(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := balancesJSON{Tokens: []tokenBalanceJSON{}}
		if b.EstimatedUSD != "" {
			out.EstimatedUSDTotal = &b.EstimatedUSD
		}
		for _, t := range b.Tokens {
			j := tokenBalanceJSON{tokenJSON: toTokenJSON(t.Asset), Pending: t.Pending.String(), Held: t.Held.String()}
			if t.Wallet != nil {
				wallet, block := t.Wallet.String(), t.Block
				j.Wallet, j.FinalizedBlock = &wallet, &block
			}
			out.Tokens = append(out.Tokens, j)
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

func getBalanceHistory(balances *balance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		days, err := httpio.IntQuery(r, "days", balance.DefaultDays)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		h, err := balances.History(r.Context(), r.PathValue("profileId"), days, time.Now())
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := balanceHistoryJSON{Points: []historyPointJSON{}, Tokens: []tokenHistoryJSON{}}
		for _, p := range h.Points {
			out.Points = append(out.Points, historyPointJSON{At: p.At.Format(time.RFC3339),
				EstimatedUSD: httpio.OrNull(p.EstimatedUSD), ReceivedUSD: httpio.OrNull(p.ReceivedUSD), SentUSD: httpio.OrNull(p.SentUSD)})
		}
		for _, t := range h.Tokens {
			out.Tokens = append(out.Tokens, tokenHistoryJSON{tokenJSON: toTokenJSON(t.Asset),
				Balances: baseUnits(t.Balances), Received: baseUnits(t.Received), Sent: baseUnits(t.Sent)})
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}
