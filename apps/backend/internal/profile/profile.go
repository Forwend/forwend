// Package profile signs users up and keeps their profiles, each with one Privy wallet (R-32, D-20, D-21).
package profile

import (
	"errors"
	"time"
)

// Owner is a Profile's Role for the user who made it; a member's role is auth's (R-138).
const Owner = "owner"

// Profile kinds (D-20). Personal is made at signup; the others by request.
const (
	Personal   = "personal"
	Freelancer = "freelancer"
	Merchant   = "merchant"
)

const MaxNameLength = 64 // characters

// MaxProfiles is per user, the personal profile included.
const MaxProfiles = 10

var (
	// ErrInvalid wraps a request value that breaks a rule; the message names it.
	ErrInvalid     = errors.New("invalid profile request")
	ErrConflict    = errors.New("idempotency key reused with another request")
	ErrNotSignedUp = errors.New("user has not signed up")
)

// WalletAddress is "" until Privy has made the wallet; repeating the request retries a failed create. Role is the
// user's on it: "owner", or a member's role (R-138).
type Profile struct {
	ID            string
	Kind          string
	Name          string
	WalletAddress string
	CreatedAt     time.Time
	Role          string
	Livemode      bool   // false while Developer mode is on (D-120)
	FeesPaidBy    string // who pays its invoices' fees unless one says otherwise (D-122): owner or client
}
