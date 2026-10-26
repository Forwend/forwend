// Package apikey keeps a profile's secret API keys (R-144, D-87): a key acts for its profile, and for one store of a
// merchant, within the scopes it was made with.
package apikey

import (
	"errors"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Scopes are what a key may be made with: a developer's invoice work, and never money, the team, billing details or a
// store's settings (D-61).
var Scopes = []auth.Permission{auth.InvoicesRead, auth.InvoicesWrite, auth.StoresRead, auth.TokensRead}

// A rolled key keeps working beside its new one for DefaultOverlap, unless the owner picks up to MaxOverlap (D-95).
const (
	DefaultOverlap = 24 * time.Hour
	MaxOverlap     = 7 * 24 * time.Hour
)

var (
	// ErrInvalid wraps a request value that breaks a rule; the message names it.
	ErrInvalid  = errors.New("invalid API key request")
	ErrNotFound = errors.New("API key not found")
	// ErrPersonal: a personal profile makes requests in the app and has no API.
	ErrPersonal = errors.New("a personal profile has no API keys")
	// ErrUnknownKey answers a request whose key is not one, or is revoked or past its overlap.
	ErrUnknownKey = errors.New("unknown API key")
)

// Key is one of a profile's keys. Its text is never kept: only Last4, its last 4 characters, is shown again.
// ExpiresAt is set once the key was rolled: it works until then.
type Key struct {
	ID         string
	StoreID    string // "" for a freelancer
	Name       string
	Livemode   bool
	Last4      string
	Scopes     []auth.Permission
	CreatedAt  time.Time
	LastUsedAt *time.Time
	ExpiresAt  *time.Time
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}
