// Package keyapi serves a profile's secret API keys (R-144) of docs/backend/api.md.
package keyapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/apikey"
	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
)

// Making or rolling a key gives out its text, so it needs a fresh sign-in (D-63); revoking one does not.
func Routes(mux *http.ServeMux, g mid.Guards, keys *apikey.Service) {
	mux.Handle("GET /v1/profiles/{profileId}/keys", g.Can(auth.Keys)(listKeys(keys)))
	mux.Handle("POST /v1/profiles/{profileId}/keys", g.FreshSignIn(auth.Keys)(createKey(keys)))
	mux.Handle("POST /v1/profiles/{profileId}/keys/{keyId}/roll", g.FreshSignIn(auth.Keys)(rollKey(keys)))
	mux.Handle("DELETE /v1/profiles/{profileId}/keys/{keyId}", g.Can(auth.Keys)(revokeKey(keys)))
}
