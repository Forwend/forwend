package webhookapi

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
		{spec: openapi.WebhookEndpoint{}, hand: endpointJSON{}, answer: true},
		{spec: openapi.WebhookEndpointRequest{}, hand: endpointBody{}, answer: false},
		{spec: openapi.WebhookSecrets{}, hand: secretsJSON{}, answer: true},
		{spec: openapi.WebhookDelivery{}, hand: deliveryJSON{}, answer: true},
		{spec: openapi.ResendFailedWebhookDeliveriesJSONBody{}, hand: resendFailedBody{}, answer: false},
	} {
		for _, d := range openapi.Diff(c.spec, c.hand, c.answer, c.loose...) {
			t.Errorf("%T: %s", c.hand, d)
		}
	}
}
