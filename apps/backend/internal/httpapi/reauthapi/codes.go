package reauthapi

import (
	"errors"
	"math"
	"net/http"
	"strconv"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/reauth"
)

func sendCode(codes *reauth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		wait, err := codes.Send(r.Context(), mid.SignedInToken(r))
		if errors.Is(err, reauth.ErrTooSoon) || errors.Is(err, reauth.ErrTooMany) {
			w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
		}
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusAccepted, map[string]int{"resendAfterSeconds": int(wait.Seconds())})
	}
}

func verifyCode(codes *reauth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Code string `json:"code"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		if err := codes.Verify(r.Context(), mid.SignedInToken(r), body.Code); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
