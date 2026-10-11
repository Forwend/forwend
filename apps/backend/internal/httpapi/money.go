package httpapi

import (
	"fmt"
	"math/big"
	"net/http"
	"strconv"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
	"github.com/ensp1re/forwend/apps/backend/internal/balance"
	"github.com/ensp1re/forwend/apps/backend/internal/search"
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
	Symbol           string `json:"symbol"`
	Decimals         int    `json:"decimals"`
	Amount           string `json:"amount"`
	Status           string `json:"status"`
	SettlementStatus string `json:"settlementStatus,omitempty"`
	TxHash           string `json:"txHash,omitempty"`
}

type transactionsJSON struct {
	Items      []transactionJSON `json:"items"`
	NextCursor *string           `json:"nextCursor"`
}

type transactionJSON struct {
	ChainID      uint64 `json:"chainId"`
	Token        string `json:"token"`
	Symbol       string `json:"symbol"`
	Decimals     int    `json:"decimals"`
	Direction    string `json:"direction"`
	Amount       string `json:"amount"`
	Counterparty string `json:"counterparty"`
	TxHash       string `json:"txHash"`
	LogIndex     uint64 `json:"logIndex"`
	BlockNumber  uint64 `json:"blockNumber"`
	At           string `json:"at"`
	Status       string `json:"status"`
}

type balanceHistoryJSON struct {
	Points []historyPointJSON `json:"points"`
	Tokens []tokenHistoryJSON `json:"tokens"`
}

type historyPointJSON struct {
	At           string  `json:"at"`
	EstimatedUSD *string `json:"estimatedUsd"`
	ReceivedUSD  *string `json:"receivedUsd"`
	SentUSD      *string `json:"sentUsd"`
}

type tokenHistoryJSON struct {
	ChainID  uint64   `json:"chainId"`
	Token    string   `json:"token"`
	Symbol   string   `json:"symbol"`
	Decimals int      `json:"decimals"`
	Balances []string `json:"balances"`
	Received []string `json:"received"`
	Sent     []string `json:"sent"`
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

// getActivity is GET /v1/profiles/{profileId}/activity?limit=&cursor=&status=&q=.
func getActivity(activities *activity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, err := intQuery(r, "limit", activity.DefaultLimit)
		if err != nil {
			writeError(w, r, err)
			return
		}
		q, err := searchQuery(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		query := r.URL.Query()
		page, err := activities.List(r.Context(), r.PathValue("profileId"), query.Get("cursor"), limit, query.Get("status"), q)
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
				InvoiceID: it.InvoiceID, ChainID: it.ChainID, Token: it.Token, Symbol: it.Symbol, Decimals: it.Decimals,
				Amount: it.Amount.String(),
				Status: it.Status, SettlementStatus: it.SettlementStatus, TxHash: it.TxHash})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// getTransactions is GET /v1/profiles/{profileId}/transactions?limit=&cursor=&direction=&q=.
func getTransactions(activities *activity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, err := intQuery(r, "limit", activity.DefaultLimit)
		if err != nil {
			writeError(w, r, err)
			return
		}
		q, err := searchQuery(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		query := r.URL.Query()
		page, err := activities.Transfers(r.Context(), r.PathValue("profileId"), query.Get("cursor"), limit,
			query.Get("direction"), q)
		if err != nil {
			writeError(w, r, err)
			return
		}
		out := transactionsJSON{Items: []transactionJSON{}}
		if page.NextCursor != "" {
			out.NextCursor = &page.NextCursor
		}
		for _, t := range page.Items {
			out.Items = append(out.Items, transactionJSON{ChainID: t.ChainID, Token: t.Token, Symbol: t.Symbol,
				Decimals: t.Decimals, Direction: t.Direction, Amount: t.Amount.String(), Counterparty: t.Counterparty,
				TxHash: t.TxHash, LogIndex: t.LogIndex, BlockNumber: t.BlockNumber, At: t.At.Format(time.RFC3339),
				Status: t.Status})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// getBalanceHistory is GET /v1/profiles/{profileId}/balance-history?days=.
func getBalanceHistory(balances *balance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		days, err := intQuery(r, "days", balance.DefaultDays)
		if err != nil {
			writeError(w, r, err)
			return
		}
		h, err := balances.History(r.Context(), r.PathValue("profileId"), days, time.Now())
		if err != nil {
			writeError(w, r, err)
			return
		}
		out := balanceHistoryJSON{Points: []historyPointJSON{}, Tokens: []tokenHistoryJSON{}}
		for _, p := range h.Points {
			out.Points = append(out.Points, historyPointJSON{At: p.At.Format(time.RFC3339),
				EstimatedUSD: orNull(p.EstimatedUSD), ReceivedUSD: orNull(p.ReceivedUSD), SentUSD: orNull(p.SentUSD)})
		}
		for _, t := range h.Tokens {
			out.Tokens = append(out.Tokens, tokenHistoryJSON{ChainID: t.ChainID, Token: t.Token, Symbol: t.Symbol,
				Decimals: t.Decimals, Balances: baseUnits(t.Balances), Received: baseUnits(t.Received), Sent: baseUnits(t.Sent)})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// baseUnits writes amounts as decimal strings; nil stays nil (JSON null).
func baseUnits(amounts []*big.Int) []string {
	if amounts == nil {
		return nil
	}
	out := make([]string, len(amounts))
	for i, a := range amounts {
		out[i] = a.String()
	}
	return out
}

// searchQuery reads ?q=: absent is no search, present it must not be blank.
func searchQuery(r *http.Request) (search.Query, error) {
	if !r.URL.Query().Has("q") {
		return search.Query{}, nil
	}
	return search.Parse(r.URL.Query().Get("q"))
}

// intQuery reads a whole-number query parameter, or def when it is absent.
func intQuery(r *http.Request, name string, def int) (int, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%w: %s must be a whole number", errMalformed, name)
	}
	return n, nil
}
