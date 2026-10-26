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
