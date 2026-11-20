package paymentapi

import (
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/openapi"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/paymentio"
)

func TestJSONMatchesTheSpec(t *testing.T) {
	for _, c := range []struct {
		spec, hand any
		answer     bool
		loose      []string
	}{
		{spec: openapi.Payment{}, hand: paymentio.Payment{}, answer: true},
		{spec: openapi.PaymentDetails{}, hand: detailsJSON{}, answer: true},
		{spec: openapi.GetPaymentAttention200JSONResponseBody_Items{}, hand: attentionItemJSON{}, answer: true},
		{spec: openapi.PaymentMovement{}, hand: movementJSON{}, answer: true},
		{spec: openapi.PaymentReconciliationAsset{}, hand: reconciliationAssetJSON{}, answer: true},
		{spec: openapi.PaymentWebhookProblem{}, hand: webhookProblemJSON{}, answer: true},
	} {
		for _, d := range openapi.Diff(c.spec, c.hand, c.answer, c.loose...) {
			t.Errorf("%T: %s", c.hand, d)
		}
	}
}
