// Package profileapi serves the account and profile endpoints of docs/backend/api.md.
package profileapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

func Routes(mux *http.ServeMux, g mid.Guards, profiles *profile.Service) {
	mux.Handle("POST /v1/me", g.SignedIn(signUp(profiles)))
	mux.Handle("GET /v1/me", g.SignedIn(getMe(profiles)))
	mux.Handle("POST /v1/me/onboarding", g.SignedIn(onboard(profiles)))
	mux.Handle("POST /v1/profiles", g.SignedIn(createProfile(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/billing-details", g.ProfileScoped(putBillingDetails(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/billing-details", g.ProfileScoped(getBillingDetails(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/clients", g.ProfileScoped(listClients(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/clients/{clientId}", g.ProfileScoped(putClient(profiles)))
	mux.Handle("DELETE /v1/profiles/{profileId}/clients/{clientId}", g.ProfileScoped(deleteClient(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/stores", g.ProfileScoped(listStores(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/stores/{storeId}", g.ProfileScoped(putStore(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/stores/{storeId}/logo", g.ProfileScoped(putStoreLogo(profiles)))
	mux.Handle("DELETE /v1/profiles/{profileId}/stores/{storeId}/logo", g.ProfileScoped(deleteStoreLogo(profiles)))
	mux.Handle("GET /v1/stores/{storeId}/logo.png", getStoreLogo(profiles)) // pay pages show it: no sign-in
	mux.Handle("GET /v1/profiles/{profileId}/tokens", g.ProfileScoped(getTokens(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/tokens", g.ProfileScoped(putTokens(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/notifications", g.ProfileScoped(getNotifications(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/notifications", g.ProfileScoped(putNotifications(profiles)))
}
