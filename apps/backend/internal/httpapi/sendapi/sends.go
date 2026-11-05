package sendapi

import (
	"fmt"
	"math/big"
	"net/http"
	"strconv"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/send"
)

func prepareSend(sends *send.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ChainID     uint64 `json:"chainId"`
			Token       string `json:"token"`
			To          string `json:"to"`
			ToProfileID string `json:"toProfileId"`
			Amount      string `json:"amount"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		amount, ok := new(big.Int).SetString(body.Amount, 10)
		if !ok {
			httpio.WriteError(w, r, fmt.Errorf("%w: amount must be a whole number of base units", send.ErrInvalid))
			return
		}
		s, err := sends.Prepare(r.Context(), r.PathValue("profileId"), send.Request{ChainID: body.ChainID,
			Token: body.Token, To: body.To, ToProfileID: body.ToProfileID, Amount: amount})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusCreated, toSendJSON(s))
	}
}

func listPendingSends(sends *send.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := sends.Pending(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			Sends []sendJSON `json:"sends"`
		}{Sends: []sendJSON{}}
		for _, s := range list {
			out.Sends = append(out.Sends, toSendJSON(s))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

func getSendFee(sends *send.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		chainID, err := strconv.ParseUint(r.URL.Query().Get("chainId"), 10, 64)
		if err != nil {
			httpio.WriteError(w, r, fmt.Errorf("%w: chainId must be a chain id", send.ErrInvalid))
			return
		}
		fee, err := sends.Fee(r.Context(), r.PathValue("profileId"), chainID, r.URL.Query().Get("token"),
			r.URL.Query().Get("to"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		paidBy := paidByForwend
		if fee.Sign() > 0 {
			paidBy = paidByWallet
		}
		httpio.WriteJSON(w, http.StatusOK, feeJSON{Amount: fee.String(), PaidBy: paidBy})
	}
}

func getSend(sends *send.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s, err := sends.Get(r.Context(), r.PathValue("profileId"), r.PathValue("sendId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toSendJSON(s))
	}
}

func submitSend(sends *send.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			TxHash string `json:"txHash"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		s, err := sends.Submit(r.Context(), r.PathValue("profileId"), r.PathValue("sendId"), body.TxHash)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toSendJSON(s))
	}
}

func cancelSend(sends *send.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := sends.Cancel(r.Context(), r.PathValue("profileId"), r.PathValue("sendId")); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
