package reauthapi

import (
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/openapi"
)

func TestJSONMatchesTheSpec(t *testing.T) {
	for _, c := range []struct{ spec, hand any }{
		{spec: openapi.VerifyFreshSignInCodeJSONBody{}, hand: codeBody{}},
		{spec: openapi.RecordTwoStepJSONBody{}, hand: twoStepBody{}},
	} {
		for _, d := range openapi.Diff(c.spec, c.hand, false) {
			t.Errorf("%T: %s", c.hand, d)
		}
	}
}
