package jobapi

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
		{spec: openapi.CreateJobRequest{}, hand: createJobBody{}, answer: false},
		{spec: openapi.Job{}, hand: jobJSON{}, answer: true},
		{spec: openapi.PublicJob{}, hand: publicJobJSON{}, answer: true},
		{spec: openapi.AcceptJobJSONBody{}, hand: acceptBody{}, answer: false},
		{spec: openapi.MarkPaymentDoneJSONBody{}, hand: markDoneBody{}, answer: false},
		{spec: openapi.ProposeChangeJSONBody{}, hand: changeBody{}, answer: false},
		{spec: openapi.AcceptChangeJSONBody{}, hand: acceptChangeBody{}, answer: false},
	} {
		for _, d := range openapi.Diff(c.spec, c.hand, c.answer, c.loose...) {
			t.Errorf("%T: %s", c.hand, d)
		}
	}
}
