package keyapi

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
		{spec: openapi.ApiKey{}, hand: keyJSON{}, answer: true},
		{spec: openapi.NewApiKey{}, hand: createdJSON{}, answer: true},
		{spec: openapi.ApiKeyRequest{}, hand: createKeyBody{}, answer: false},
		{spec: openapi.RollApiKeyJSONBody{}, hand: rollKeyBody{}, answer: false},
	} {
		for _, d := range openapi.Diff(c.spec, c.hand, c.answer, c.loose...) {
			t.Errorf("%T: %s", c.hand, d)
		}
	}
}
