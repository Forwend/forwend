// Package webhook keeps a profile's webhook endpoints, the secrets that sign their events, and deliveries.
package webhook

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const InvoicePaid = "invoice.paid"

// Overlap is how long a rotated secret keeps signing beside its new one.
const Overlap = 24 * time.Hour

var (
	ErrInvalid       = errors.New("invalid webhook request")
	ErrNotFound      = errors.New("webhook endpoint not found")
	ErrPersonal      = errors.New("a personal profile has no webhooks")
	ErrNotConfigured = errors.New("webhooks are not configured") // no WEBHOOK_SECRET_KEY
)

type Endpoint struct {
	ID          string
	StoreID     string // "" = all stores, or a freelancer
	URL         string
	Description string
	Events      []string
	Enabled     bool
	Livemode    bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Details struct {
	URL         string
	Description string
	StoreID     string
	Events      []string
	Enabled     bool
}

type Secret struct {
	Text      string
	CreatedAt time.Time
	ExpiresAt *time.Time // set once rotated; signs until then
}

type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type Service struct {
	pool *pgxpool.Pool
	key  []byte // WEBHOOK_SECRET_KEY; nil leaves webhooks off
}

func NewService(pool *pgxpool.Pool, key []byte) *Service {
	return &Service{pool: pool, key: key}
}
