package reauthapi

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strconv"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/privy"
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

// recordTwoStep: methods names the MFA types the user just set up, which Privy must list before they are recorded.
func recordTwoStep(codes *reauth.Service, users *privy.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Methods []string `json:"methods"`
		}
		err := httpio.DecodeJSON(w, r, &body)
		if err == nil && (len(body.Methods) == 0 || len(body.Methods) > 3 || slices.ContainsFunc(body.Methods,
			func(m string) bool { return m != "passkey" && m != "totp" && m != "sms" })) {
			err = fmt.Errorf("%w: methods names one to three of passkey, totp and sms", httpio.ErrMalformed)
		}
		if err == nil {
			user := mid.SignedInUser(r)
			err = codes.RecordTwoStep(r.Context(), user, body.Methods, func(ctx context.Context) ([]string, error) {
				_, methods, err := users.SignInTimes(ctx, user, "")
				return methods, err
			})
		}
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
