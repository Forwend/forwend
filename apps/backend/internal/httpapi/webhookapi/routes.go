// Package webhookapi serves a profile's webhook endpoints (R-146) and their deliveries (R-149) of docs/backend/api.md.
package webhookapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
)

// Saving an endpoint decides where events go, and a secret signs them, so both need a fresh sign-in (D-63); a
// deletion does not.
func Routes(mux *http.ServeMux, g mid.Guards, webhooks *webhook.Service) {
	mux.Handle("GET /v1/profiles/{profileId}/webhooks", g.Can(auth.Webhooks)(listEndpoints(webhooks)))
	mux.Handle("PUT /v1/profiles/{profileId}/webhooks/{endpointId}", g.FreshSignIn(auth.Webhooks)(putEndpoint(webhooks)))
	mux.Handle("DELETE /v1/profiles/{profileId}/webhooks/{endpointId}", g.Can(auth.Webhooks)(deleteEndpoint(webhooks)))
	mux.Handle("GET /v1/profiles/{profileId}/webhooks/{endpointId}/secret",
		g.FreshSignIn(auth.Webhooks)(revealSecrets(webhooks)))
	mux.Handle("POST /v1/profiles/{profileId}/webhooks/{endpointId}/secret/rotate",
		g.FreshSignIn(auth.Webhooks)(rotateSecret(webhooks)))
	// R-149: a resend or test goes only where the endpoint already sends, so it needs no fresh sign-in.
	mux.Handle("GET /v1/profiles/{profileId}/webhooks/{endpointId}/deliveries",
		g.Can(auth.Webhooks)(listDeliveries(webhooks)))
	mux.Handle("POST /v1/profiles/{profileId}/webhooks/{endpointId}/deliveries/{eventId}/resend",
		g.Can(auth.Webhooks)(resendDelivery(webhooks)))
	mux.Handle("POST /v1/profiles/{profileId}/webhooks/{endpointId}/deliveries/resend-failed",
		g.Can(auth.Webhooks)(resendFailed(webhooks)))
	mux.Handle("POST /v1/profiles/{profileId}/webhooks/{endpointId}/test", g.Can(auth.Webhooks)(sendTest(webhooks)))
}
