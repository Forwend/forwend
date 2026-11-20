package profileapi

import (
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/openapi"
)

func TestJSONMatchesTheSpec(t *testing.T) {
	for _, c := range []struct {
		spec, hand any
		answer     bool
		loose      []string
	}{
		{spec: openapi.Me{}, hand: meJSON{}, answer: true},
		{spec: openapi.Profile{}, hand: profileJSON{}, answer: true},
		{spec: openapi.CreateProfileRequest{}, hand: createProfileBody{}, answer: false},
		{spec: openapi.OnboardingRequest{}, hand: onboardingBody{}, answer: false},
		{spec: openapi.BillingDetails{}, hand: billingDetailsJSON{}, answer: true},
		{spec: openapi.BillingDetailsRequest{}, hand: billingDetailsBody{}, answer: false},
		{spec: openapi.Client{}, hand: clientJSON{}, answer: true},
		{spec: openapi.ClientRequest{}, hand: clientBody{}, answer: false},
		{spec: openapi.Store{}, hand: storeJSON{}, answer: true},
		{spec: openapi.StoreRequest{}, hand: storeBody{}, answer: false},
		{spec: openapi.Notifications{}, hand: notificationsJSON{}, answer: true},
		{spec: openapi.PutNotificationsJSONBody{}, hand: notificationsBody{}, answer: false},
		{spec: openapi.PutProfileMode200JSONResponseBody{}, hand: modeJSON{}, answer: true},
		{spec: openapi.PutProfileModeJSONBody{}, hand: modeBody{}, answer: false},
		{spec: openapi.PutProfileFeesJSONBody{}, hand: feesBody{}, answer: false},
		{spec: openapi.ProfileTokens{}, hand: tokensJSON{}, answer: true},
		{spec: openapi.PutProfileTokensJSONBody{}, hand: tokensBody{}, answer: false},
	} {
		for _, d := range openapi.Diff(c.spec, c.hand, c.answer, c.loose...) {
			t.Errorf("%T: %s", c.hand, d)
		}
	}
}
