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
}
