package sendapi

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
		{spec: openapi.Send{}, hand: sendJSON{}, answer: true},
		{spec: openapi.SendFee{}, hand: feeJSON{}, answer: true},
		{spec: openapi.PrepareSendJSONBody{}, hand: prepareSendBody{}, answer: false},
	} {
		for _, d := range openapi.Diff(c.spec, c.hand, c.answer, c.loose...) {
			t.Errorf("%T: %s", c.hand, d)
		}
	}
}
