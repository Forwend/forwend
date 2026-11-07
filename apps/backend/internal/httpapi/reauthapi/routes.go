// Package reauthapi serves Confirm it's you (R-137) of docs/backend/api.md: Forwend's own emailed code.
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
	// Privy changes the account in the browser (a passkey, R-217): Forwend's screens ask here first, so a stale session
	// confirms it's you there. Privy's own API isn't bound by it: a stolen session could still call Privy (Q-13).
	mux.Handle("GET /v1/me/fresh-sign-in", g.FreshSignedIn(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))
	// R-219: the MFA methods the user has at Privy, recorded behind a fresh sign-in. From then on they stand in for the
	// emailed code on a send (D-49); one set up at Privy without this, or set up again, doesn't.
	mux.Handle("PUT /v1/me/two-step", g.FreshSignedIn(recordTwoStep(codes, users)))
}
