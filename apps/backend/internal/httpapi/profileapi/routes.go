// Package profileapi serves sign-up, the user's profiles and their billing details (docs/backend/api.md).
package profileapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

// Routes mounts the account and profile endpoints on mux, all signed in; billing details also need the profile.
func Routes(mux *http.ServeMux, g mid.Guards, profiles *profile.Service) {
	mux.Handle("POST /v1/me", g.SignedIn(signUp(profiles)))
	mux.Handle("GET /v1/me", g.SignedIn(getMe(profiles)))
	mux.Handle("POST /v1/me/onboarding", g.SignedIn(onboard(profiles)))
	mux.Handle("POST /v1/profiles", g.SignedIn(createProfile(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/billing-details", g.ProfileScoped(putBillingDetails(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/billing-details", g.ProfileScoped(getBillingDetails(profiles)))
}
