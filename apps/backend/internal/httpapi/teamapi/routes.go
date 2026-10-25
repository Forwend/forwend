// Package teamapi serves a merchant profile's team and its invites (R-139) of docs/backend/api.md.
package teamapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/team"
)

func Routes(mux *http.ServeMux, g mid.Guards, members *team.Service) {
	mux.Handle("GET /v1/profiles/{profileId}/members", g.Can(auth.Team)(listTeam(members)))
	// D-63: giving someone a role, by invite or by change, needs a fresh sign-in; taking access away does not.
	mux.Handle("PUT /v1/profiles/{profileId}/members/{memberId}", g.FreshSignIn(auth.Team)(setMember(members)))
	mux.Handle("DELETE /v1/profiles/{profileId}/members/{memberId}", g.Can(auth.Team)(removeMember(members)))
	mux.Handle("POST /v1/profiles/{profileId}/invites", g.FreshSignIn(auth.Team)(invite(members)))
	mux.Handle("DELETE /v1/profiles/{profileId}/invites/{inviteId}", g.Can(auth.Team)(revoke(members)))
	mux.Handle("POST /v1/profiles/{profileId}/leave", g.Can(auth.Leave)(leave(members)))
	// Any signed-in user with the link reads it; only the invited address accepts it.
	mux.Handle("GET /v1/invites/{token}", g.SignedIn(readInvite(members)))
	mux.Handle("POST /v1/invites/{token}/accept", g.SignedIn(accept(members)))
}
