// Package profile signs users up and keeps their profiles, each with one Privy wallet (R-32, D-20, D-21).
package profile

import (
	"errors"
	"time"
)

// Profile kinds (D-20). Personal is made at signup; the others by request.
const (
	Personal   = "personal"
	Freelancer = "freelancer"
	Merchant   = "merchant"
)

const MaxNameLength = 64 // characters

var (
	// ErrInvalid wraps a request value that breaks a rule; the message names it.
	ErrInvalid = errors.New("invalid profile request")
	// ErrConflict means the idempotency key was used with another request.
	ErrConflict = errors.New("idempotency key reused with another request")
	// ErrNotSignedUp means the user has not called signup yet.
	ErrNotSignedUp = errors.New("user has not signed up")
)

// Profile is one of a user's profiles. Name is "" when none was given; WalletAddress is "" until Privy has made the
// wallet (a failed create is retried by repeating the request).
type Profile struct {
	ID            string
	Kind          string
	Name          string
	WalletAddress string
	CreatedAt     time.Time
}
