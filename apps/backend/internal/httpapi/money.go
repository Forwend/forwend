package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
	"github.com/ensp1re/forwend/apps/backend/internal/balance"
)

type balancesJSON struct {
	Tokens            []tokenBalanceJSON `json:"tokens"`
	EstimatedUSDTotal *string            `json:"estimatedUsdTotal"`
}

type tokenBalanceJSON struct {
	ChainID        uint64  `json:"chainId"`
	Token          string  `json:"token"`
	Symbol         string  `json:"symbol"`
	Decimals       int     `json:"decimals"`
	Wallet         *string `json:"wallet"`
	FinalizedBlock *uint64 `json:"finalizedBlock"`
	Pending        string  `json:"pending"`
	Held           string  `json:"held"`
}

type activityJSON struct {
	Items      []activityItemJSON `json:"items"`
	NextCursor *string            `json:"nextCursor"`
}

type activityItemJSON struct {
	Kind             string `json:"kind"`
	At               string `json:"at"`
	InvoiceID        string `json:"invoiceId"`
	ChainID          uint64 `json:"chainId"`
	Token            string `json:"token"`
	Amount           string `json:"amount"`
	Status           string `json:"status"`
	SettlementStatus string `json:"settlementStatus,omitempty"`
	TxHash           string `json:"txHash,omitempty"`
}

// getBalances is GET /v1/profiles/{profileId}/balances.
func getBalances(balances *balance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		b, err := balances.Of(r.Context(), r.PathValue("profileId"))
		if err != nil {
			writeError(w, r, err)
			return
		}
		out := balancesJSON{Tokens: []tokenBalanceJSON{}}
		if b.EstimatedUSD != "" {
			out.EstimatedUSDTotal = &b.EstimatedUSD
		}
		for _, t := range b.Tokens {
			j := tokenBalanceJSON{ChainID: t.ChainID, Token: t.Token, Symbol: t.Symbol, Decimals: t.Decimals,
				Pending: t.Pending.String(), Held: t.Held.String()}
			if t.Wallet != nil {
				wallet, block := t.Wallet.String(), t.Block
				j.Wallet, j.FinalizedBlock = &wallet, &block
			}
			out.Tokens = append(out.Tokens, j)
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// getActivity is GET /v1/profiles/{profileId}/activity?limit=&cursor=.
func getActivity(activities *activity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := activity.DefaultLimit
		if raw := r.URL.Query().Get("limit"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil {
				writeError(w, r, fmt.Errorf("%w: limit must be a whole number", errMalformed))
				return
			}
			limit = n
		}
		page, err := activities.List(r.Context(), r.PathValue("profileId"), r.URL.Query().Get("cursor"), limit)
		if err != nil {
			writeError(w, r, err)
			return
		}
		out := activityJSON{Items: []activityItemJSON{}}
		if page.NextCursor != "" {
			out.NextCursor = &page.NextCursor
		}
		for _, it := range page.Items {
			out.Items = append(out.Items, activityItemJSON{Kind: it.Kind, At: it.At.UTC().Format(time.RFC3339Nano),
				InvoiceID: it.InvoiceID, ChainID: it.ChainID, Token: it.Token, Amount: it.Amount.String(),
				Status: it.Status, SettlementStatus: it.SettlementStatus, TxHash: it.TxHash})
		}
		writeJSON(w, http.StatusOK, out)
	}
}
