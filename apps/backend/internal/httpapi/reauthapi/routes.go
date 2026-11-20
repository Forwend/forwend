// Package reauthapi serves Confirm it's you: Forwend's own emailed code.
package reauthapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/forwend/forwend/apps/backend/internal/reauth"
)

// Any signed-in person asks for a code and confirms it; a key has no session to confirm.
func Routes(mux *http.ServeMux, g mid.Guards, codes *reauth.Service, users *privy.Client) {
	mux.Handle("POST /v1/me/fresh-sign-in", g.SignedIn(sendCode(codes)))
	mux.Handle("POST /v1/me/fresh-sign-in/verify", g.SignedIn(verifyCode(codes)))
	// Forwend's screens ask here before Privy changes the account; Privy's own API isn't bound by it.
	mux.Handle("GET /v1/me/fresh-sign-in", g.FreshSignedIn(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))
	// Recorded MFA methods stand in for the emailed code on a send; one set up at Privy without this doesn't.
	mux.Handle("PUT /v1/me/two-step", g.FreshSignedIn(recordTwoStep(codes, users)))
}
