// Package reauthapi serves Confirm it's you (R-137) of docs/backend/api.md: Forwend's own emailed code.
package reauthapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/reauth"
)

// Any signed-in person asks for a code and confirms it; a key has no session to confirm.
func Routes(mux *http.ServeMux, g mid.Guards, codes *reauth.Service) {
	mux.Handle("POST /v1/me/fresh-sign-in", g.SignedIn(sendCode(codes)))
	mux.Handle("POST /v1/me/fresh-sign-in/verify", g.SignedIn(verifyCode(codes)))
	// Privy changes the account in the browser (a passkey, R-217): the web asks here first, so a stale session
	// confirms it's you before it can.
	mux.Handle("GET /v1/me/fresh-sign-in", g.FreshSignedIn(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))
}
