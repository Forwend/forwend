// Package team keeps a merchant profile's members and invites. What a role may do is auth's map.
package team

import (
	"errors"
	"time"
)

var (
	ErrInvalid        = errors.New("invalid team request")
	ErrNotMerchant    = errors.New("only a merchant profile has a team")
	ErrMemberNotFound = errors.New("member not found")
	// Unknown, used, revoked and expired invites look the same.
	ErrInviteNotFound = errors.New("invite not found")
	ErrOtherEmail     = errors.New("the invite is for another email")
	ErrOnTeam         = errors.New("already on the team")
)

type Member struct {
	UserID    string
	Email     string // login email; "" when none
	Role      string
	Stores    []string // empty for the owner and Admins
	CreatedAt time.Time
}

type Invite struct {
	ID        string
	Email     string
	Role      string
	Stores    []string
	CreatedAt time.Time
	ExpiresAt time.Time
}

// Team lists the owner first, then the members, and the open invites newest first.
type Team struct {
	Members []Member
	Invites []Invite
}

type Grant struct {
	Role   string
	Stores []string
}

type Invitation struct {
	ProfileName string
	Email       string
	Role        string
	ExpiresAt   time.Time
}
