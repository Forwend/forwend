// Package webhook keeps a profile's webhook endpoints and the secrets that sign their events (R-146, D-42).
package webhook

import (
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The events an endpoint can take (PLAN 11.5); invoice.confirmed is not one (owner decision 6).
const (
	InvoiceDetected      = "invoice.detected"
	InvoicePartiallyPaid = "invoice.partially_paid"
	InvoicePaid          = "invoice.paid"
	InvoiceSettled       = "invoice.settled"
	InvoiceExpired       = "invoice.expired"
	InvoiceCanceled      = "invoice.canceled"
	InvoiceHeld          = "invoice.held"
)

var EventTypes = []string{InvoiceDetected, InvoicePartiallyPaid, InvoicePaid, InvoiceSettled, InvoiceExpired,
	InvoiceCanceled, InvoiceHeld}

// Overlap is how long a rotated secret keeps signing beside its new one.
const Overlap = 24 * time.Hour

var (
	// ErrInvalid wraps a request value that breaks a rule; the message names it.
	ErrInvalid  = errors.New("invalid webhook request")
	ErrNotFound = errors.New("webhook endpoint not found")
	// ErrPersonal: a personal profile has no API, so no webhooks.
	ErrPersonal = errors.New("a personal profile has no webhooks")
	// ErrNotConfigured: without WEBHOOK_SECRET_KEY no secret can be kept, so webhooks are off.
	ErrNotConfigured = errors.New("webhooks are not configured")
)

// Endpoint is where a profile's events go. StoreID is "" for all of a merchant's stores, and for a freelancer.
type Endpoint struct {
	ID          string
	StoreID     string
	URL         string
	Description string
	Events      []string
	Enabled     bool
	Livemode    bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Details are what the owner sets.
type Details struct {
	URL         string
	Description string
	StoreID     string
	Events      []string
	Enabled     bool
}

// Secret is a signing secret's text; ExpiresAt is set once rotated: it signs until then.
type Secret struct {
	Text      string
	CreatedAt time.Time
	ExpiresAt *time.Time
}

type Service struct {
	pool *pgxpool.Pool
	key  []byte // WEBHOOK_SECRET_KEY; nil leaves webhooks off
}

func NewService(pool *pgxpool.Pool, key []byte) *Service {
	return &Service{pool: pool, key: key}
}
