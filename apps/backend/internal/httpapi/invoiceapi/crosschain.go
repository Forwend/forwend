package invoiceapi

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

// Each pick asks for a dry quote, so a payer browsing tokens spends from this; a real quote also counts in the
// database (invoice.CrossChainPerHour). Anyone can make pay tokens from a public link, so all invoices also share a
// budget of 1Click calls made with Forwend's key, spent only when 1Click is called: a kept price or quote is free.
const (
	CrossTokensRate, CrossTokensBurst = 0.5, 10
	DryQuoteRate, DryQuoteBurst       = 1, 20
	QuoteRate, QuoteBurst             = 0.1, 5
	DryQuoteAllRate, DryQuoteAllBurst = 1, 20
	QuoteAllRate, QuoteAllBurst       = 0.2, 10
)

type crossTokensJSON struct {
	Due      string           `json:"due"`
	Decimals int              `json:"decimals"`
	Tokens   []crossTokenJSON `json:"tokens"`
}

type crossTokenJSON struct {
	AssetID    string  `json:"assetId"`
	Blockchain string  `json:"blockchain"`
	Symbol     string  `json:"symbol"`
	Decimals   int     `json:"decimals"`
	Contract   *string `json:"contract"`
	PriceUSD   string  `json:"priceUsd"`
	Estimate   *string `json:"estimate"` // in the list only
	// In the list only: the Base USDC base units 1Click needs at least from it (D-126).
	Minimum *string `json:"minimum"`
}

func toCrossToken(t intents.Token) crossTokenJSON {
	return crossTokenJSON{AssetID: t.AssetID, Blockchain: t.Blockchain, Symbol: t.Symbol, Decimals: t.Decimals,
		Contract: httpio.OrNull(t.Contract), PriceUSD: t.USD}
}

type crossQuoteJSON struct {
	QuoteID        *string         `json:"quoteId"`
	Token          crossTokenJSON  `json:"token"`
	DepositAddress *string         `json:"depositAddress"`
	AmountIn       string          `json:"amountIn"`
	MinAmountIn    string          `json:"minAmountIn"`
	AmountOut      string          `json:"amountOut"`
	AmountInUSD    string          `json:"amountInUsd"`
	AmountOutUSD   string          `json:"amountOutUsd"`
	RefundFee      string          `json:"refundFee"`
	TimeEstimate   int64           `json:"timeEstimate"`
	RefundTo       *string         `json:"refundTo"`
	ShownUntil     *string         `json:"shownUntil"`
	Deadline       *string         `json:"deadline"`
	CreatedAt      *string         `json:"createdAt"`
	Signed         json.RawMessage `json:"signed"`
}

func toCrossQuote(q invoice.CrossQuote) crossQuoteJSON {
	signed := json.RawMessage("null")
	if q.Signed != nil {
		signed = q.Signed
	}
	return crossQuoteJSON{QuoteID: httpio.OrNull(q.ID), Token: toCrossToken(q.Token),
		DepositAddress: httpio.OrNull(q.DepositAddress), AmountIn: q.AmountIn.String(), MinAmountIn: q.MinAmountIn.String(),
		AmountOut: q.AmountOut.String(), AmountInUSD: q.AmountInUSD, AmountOutUSD: q.AmountOutUSD, RefundFee: q.RefundFee,
		TimeEstimate: q.TimeEstimate,
		RefundTo:     httpio.OrNull(q.RefundTo), ShownUntil: httpio.OrNullTime(q.ShownUntil),
		Deadline: httpio.OrNullTime(q.Deadline), CreatedAt: httpio.OrNullTime(q.CreatedAt), Signed: signed}
}

// R-232: what the payer can pay with from another chain, and about how much of each.
func getCrossTokens(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		due, decimals, tokens, err := invoices.CrossChainTokens(r.Context(), r.PathValue("payToken"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := crossTokensJSON{Due: due.String(), Decimals: decimals, Tokens: []crossTokenJSON{}}
		for _, t := range tokens {
			j := toCrossToken(t.Token)
			if t.Estimate != nil {
				j.Estimate = httpio.OrNull(t.Estimate.String())
			}
			j.Minimum = httpio.OrNull(t.Minimum)
			out.Tokens = append(out.Tokens, j)
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

// R-232: a dry quote prices a pick, without an address.
func getCrossPrice(invoices *invoice.Service, all *mid.Buckets) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		allow := func() time.Duration { return all.Wait(mid.Everyone(r)) }
		q, err := invoices.QuoteCrossChain(r.Context(), r.PathValue("payToken"), r.URL.Query().Get("originAsset"), "", true,
			allow)
		writeCrossQuote(w, r, q, err, http.StatusOK)
	}
}

// R-231, R-233: the deposit address for the payer's token and refund address, signed by 1Click (D-124).
func postCrossQuote(invoices *invoice.Service, all *mid.Buckets) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			OriginAsset string `json:"originAsset"`
			RefundTo    string `json:"refundTo"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		allow := func() time.Duration { return all.Wait(mid.Everyone(r)) }
		q, err := invoices.QuoteCrossChain(r.Context(), r.PathValue("payToken"), body.OriginAsset, body.RefundTo, false,
			allow)
		writeCrossQuote(w, r, q, err, http.StatusCreated)
	}
}

func writeCrossQuote(w http.ResponseWriter, r *http.Request, q invoice.CrossQuote, err error, status int) {
	var below *intents.BelowMinimum
	var soon *invoice.TooSoonError
	if errors.As(err, &soon) {
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(soon.Wait.Seconds())))))
		httpio.WriteError(w, r, httpio.ErrRateLimited)
		return
	}
	if errors.As(err, &below) {
		httpio.WriteJSON(w, http.StatusUnprocessableEntity, map[string]map[string]string{"error": {
			"code": "below_minimum", "message": "this token's route needs a larger amount: choose another token",
			"minimum": below.Minimum}})
		return
	}
	if err != nil {
		httpio.WriteError(w, r, err)
		return
	}
	httpio.WriteJSON(w, status, toCrossQuote(q))
}
