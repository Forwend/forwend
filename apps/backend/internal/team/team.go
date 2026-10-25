// Package team keeps a merchant profile's members and invites (R-139, D-93). What a role may do is auth's map.
package team

import (
	"errors"
	"time"
)

var (
	// ErrInvalid wraps a request value that breaks a rule; the message names it.
	ErrInvalid        = errors.New("invalid team request")
	ErrNotMerchant    = errors.New("only a merchant profile has a team")
	ErrMemberNotFound = errors.New("member not found")
	// ErrInviteNotFound is an unknown, used, revoked or expired invite: the link says no more than that.
	ErrInviteNotFound = errors.New("invite not found")
	ErrOtherEmail     = errors.New("the invite is for another email")
	ErrOnTeam         = errors.New("already on the team")
)

// Member is the owner or a member. Email is the account's login email, "" when it has none.
type Member struct {
	UserID    string
	Email     string
	Role      string
	Stores    []string // a Developer's or Finance member's; empty for the owner and Admins
	CreatedAt time.Time
}

// Invite is an open invite: not accepted, revoked or expired.
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

// Grant is the role, and a Developer's or Finance member's stores, that an invite or a role change gives.
type Grant struct {
	Role   string
	Stores []string
}

// Invitation is what an invite link shows the user who opens it.
type Invitation struct {
	ProfileName string
	Email       string
	Role        string
	ExpiresAt   time.Time
}
