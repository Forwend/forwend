package teamapi

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
		{spec: openapi.Team{}, hand: teamJSON{}, answer: true},
		{spec: openapi.Member{}, hand: memberJSON{}, answer: true},
		{spec: openapi.Invite{}, hand: inviteJSON{}, answer: true},
		{spec: openapi.InviteRequest{}, hand: inviteBody{}, answer: false},
		{spec: openapi.GrantRequest{}, hand: grantBody{}, answer: false},
		{spec: openapi.Invitation{}, hand: invitationJSON{}, answer: true},
		{spec: openapi.ToRoll{}, hand: toRollJSON{}, answer: true},
	} {
		for _, d := range openapi.Diff(c.spec, c.hand, c.answer, c.loose...) {
			t.Errorf("%T: %s", c.hand, d)
		}
	}
}
