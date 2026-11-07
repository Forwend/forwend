package teamapi

import (
	"time"

	"github.com/forwend/forwend/apps/backend/internal/team"
)

type grantBody struct {
	Role   string   `json:"role"`
	Stores []string `json:"stores"`
}

type inviteBody struct {
	Email string `json:"email"`
	grantBody
}

type memberJSON struct {
	MemberID  string   `json:"memberId"`
	Email     *string  `json:"email"` // null when the account has no login email
	Role      string   `json:"role"`
	Stores    []string `json:"stores"`
	CreatedAt string   `json:"createdAt"`
	// Set when a role change left the member with less: what they could still use, for the owner to roll.
	ToRoll *toRollJSON `json:"toRoll,omitempty"`
}

type toRollJSON struct {
	Keys     []rollKeyJSON      `json:"keys"`
	Webhooks []rollEndpointJSON `json:"webhooks"`
}

type rollKeyJSON struct {
	KeyID string `json:"keyId"`
	Name  string `json:"name"`
	Last4 string `json:"last4"`
}

type rollEndpointJSON struct {
	EndpointID string `json:"endpointId"`
	URL        string `json:"url"`
}

func toRollJSONOf(r team.ToRoll) toRollJSON {
	out := toRollJSON{Keys: []rollKeyJSON{}, Webhooks: []rollEndpointJSON{}}
	for _, k := range r.Keys {
		out.Keys = append(out.Keys, rollKeyJSON{KeyID: k.ID, Name: k.Name, Last4: k.Last4})
	}
	for _, e := range r.Endpoints {
		out.Webhooks = append(out.Webhooks, rollEndpointJSON{EndpointID: e.ID, URL: e.URL})
	}
	return out
}

type inviteJSON struct {
	InviteID  string   `json:"inviteId"`
	Email     string   `json:"email"`
	Role      string   `json:"role"`
	Stores    []string `json:"stores"`
	CreatedAt string   `json:"createdAt"`
	ExpiresAt string   `json:"expiresAt"`
}

type teamJSON struct {
	Members []memberJSON `json:"members"`
	Invites []inviteJSON `json:"invites"`
}

type invitationJSON struct {
	ProfileName string `json:"profileName"`
	Email       string `json:"email"`
	Role        string `json:"role"`
	ExpiresAt   string `json:"expiresAt"`
}

func toMemberJSON(m team.Member) memberJSON {
	out := memberJSON{MemberID: m.UserID, Role: m.Role, Stores: m.Stores,
		CreatedAt: m.CreatedAt.UTC().Format(time.RFC3339)}
	if m.Email != "" {
		out.Email = &m.Email
	}
	return out
}

func toInviteJSON(v team.Invite) inviteJSON {
	return inviteJSON{InviteID: v.ID, Email: v.Email, Role: v.Role, Stores: v.Stores,
		CreatedAt: v.CreatedAt.UTC().Format(time.RFC3339), ExpiresAt: v.ExpiresAt.UTC().Format(time.RFC3339)}
}

func toTeamJSON(t team.Team) teamJSON {
	out := teamJSON{Members: []memberJSON{}, Invites: []inviteJSON{}}
	for _, m := range t.Members {
		out.Members = append(out.Members, toMemberJSON(m))
	}
	for _, v := range t.Invites {
		out.Invites = append(out.Invites, toInviteJSON(v))
	}
	return out
}
