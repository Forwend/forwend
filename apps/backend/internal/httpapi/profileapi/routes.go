// Package profileapi serves the account and profile endpoints of docs/backend/api.md.
package profileapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/profile"
)

func Routes(mux *http.ServeMux, g mid.Guards, profiles *profile.Service) {
	mux.Handle("POST /v1/me", g.SignedIn(signUp(profiles)))
	mux.Handle("GET /v1/me", g.SignedIn(getMe(profiles)))
	mux.Handle("POST /v1/me/onboarding", g.SignedIn(onboard(profiles)))
	mux.Handle("POST /v1/me/sign-out-everywhere", g.SignedIn(signOutEverywhere(profiles)))
	mux.Handle("POST /v1/profiles", g.SignedIn(createProfile(profiles)))
	// D-63: the issuer printed on documents moves no money, so no fresh sign-in.
	mux.Handle("PUT /v1/profiles/{profileId}/billing-details", g.Can(auth.BillingWrite)(putBillingDetails(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/billing-details", g.Can(auth.BillingRead)(getBillingDetails(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/clients", g.Can(auth.ClientsRead)(listClients(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/clients/{clientId}", g.Can(auth.ClientsRead)(getClient(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/clients/{clientId}", g.Can(auth.ClientsWrite)(putClient(profiles)))
	mux.Handle("DELETE /v1/profiles/{profileId}/clients/{clientId}", g.Can(auth.ClientsWrite)(deleteClient(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/stores", g.Can(auth.StoresRead)(listStores(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/stores/{storeId}", g.Can(auth.StoresRead)(getStore(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/stores/{storeId}", g.Can(auth.StoresWrite)(putStore(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/stores/{storeId}/logo", g.Can(auth.StoresWrite)(putStoreLogo(profiles)))
	mux.Handle("DELETE /v1/profiles/{profileId}/stores/{storeId}/logo", g.Can(auth.StoresWrite)(deleteStoreLogo(profiles)))
	mux.Handle("GET /v1/stores/{storeId}/logo.png", getStoreLogo(profiles)) // pay pages show it: no sign-in
	mux.Handle("GET /v1/profiles/{profileId}/tokens", g.Can(auth.TokensRead)(getTokens(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/tokens", g.Can(auth.TokensWrite)(putTokens(profiles)))
	mux.Handle("GET /v1/profiles/{profileId}/notifications", g.Can(auth.Notifications)(getNotifications(profiles)))
	mux.Handle("PUT /v1/profiles/{profileId}/notifications", g.Can(auth.Notifications)(putNotifications(profiles)))
}
