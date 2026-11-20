// Package apikey keeps a profile's secret API keys: each acts for its profile, or one merchant store, within its scopes.
package apikey

import (
	"errors"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Scopes never include money, the team, billing details or a store's settings.
var Scopes = []auth.Permission{auth.InvoicesRead, auth.InvoicesWrite, auth.StoresRead, auth.TokensRead}

// How long a rolled key keeps working beside its new one.
const (
	DefaultOverlap = 24 * time.Hour
	MaxOverlap     = 7 * 24 * time.Hour
)

var (
	ErrInvalid    = errors.New("invalid API key request")
	ErrNotFound   = errors.New("API key not found")
	ErrPersonal   = errors.New("a personal profile has no API keys")
	ErrUnknownKey = errors.New("unknown API key")
)

// Key's text is never kept; only Last4 is shown again.
type Key struct {
	ID         string
	StoreID    string // "" for a freelancer
	Name       string
	Livemode   bool
	Last4      string
	Scopes     []auth.Permission
	CreatedAt  time.Time
	LastUsedAt *time.Time
	ExpiresAt  *time.Time // set once rolled
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}
