package linkapi

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
		{spec: openapi.PaymentLinkRequest{}, hand: linkBody{}, answer: false},
		{spec: openapi.PaymentLink{}, hand: linkJSON{}, answer: true},
		{spec: openapi.PublicPaymentLink{}, hand: publicLinkJSON{}, answer: true},
		{spec: openapi.LinkPayRequest{}, hand: payLinkBody{}, answer: false},
	} {
		for _, d := range openapi.Diff(c.spec, c.hand, c.answer, c.loose...) {
			t.Errorf("%T: %s", c.hand, d)
		}
	}
}
