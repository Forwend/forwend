// Package profile signs users up and keeps their profiles, each with one Privy wallet.
package profile

import (
	"errors"
	"time"
)

// Personal is made at signup; the others by request.
const (
	Personal   = "personal"
	Freelancer = "freelancer"
	Merchant   = "merchant"
)

const MaxNameLength = 64 // characters

const MaxProfiles = 10 // per user, the personal profile included

var (
	ErrInvalid     = errors.New("invalid profile request")
	ErrConflict    = errors.New("idempotency key reused with another request")
	ErrNotSignedUp = errors.New("user has not signed up")
)

type Profile struct {
	ID            string
	Kind          string
	Name          string
	WalletAddress string // "" until Privy makes it
	CreatedAt     time.Time
	Role          string // "owner" or a member's role
	Livemode      bool   // false while Developer mode is on
	FeesPaidBy    string
}
