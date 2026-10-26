// Package link keeps payment links (R-140, D-54, D-94): templates a payer pays through at /l/<slug>.
package link

import (
	"errors"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxPayments is the highest payment cap an owner can set.
const MaxPayments = 1_000_000

var (
	// ErrInvalid wraps a request value that breaks a rule; the message names it.
	ErrInvalid  = errors.New("invalid payment link request")
	ErrNotFound = errors.New("payment link not found")
	// ErrPersonal: a personal profile asks for money with requests (D-52), not payment links.
	ErrPersonal = errors.New("a personal profile has no payment links")
)

// Link is a payment link. Amounts are USD cents: a fixed link has AmountCents, an open one has 0 there and the
// owner's MinCents and MaxCents, each 0 for none. StoreID is "" for a freelancer.
type Link struct {
	ID          string
	StoreID     string
	Slug        string
	Title       string
	AmountCents int64
	MinCents    int64
	MaxCents    int64
	EndsAt      *time.Time
	MaxPayments int // 0 for no cap
	Active      bool
	Visits      int64
	Paid        int64
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Details are what the owner sets; the amounts are USD decimals like "12.50", "" for none.
type Details struct {
	Title       string
	StoreID     string
	AmountUSD   string
	MinUSD      string
	MaxUSD      string
	EndsAt      *time.Time
	MaxPayments *int // nil for no cap
	Active      bool
}

type Service struct {
	pool     *pgxpool.Pool
	invoices *invoice.Service // makes a payer's invoice (R-142)
}

func NewService(pool *pgxpool.Pool, invoices *invoice.Service) *Service {
	return &Service{pool: pool, invoices: invoices}
}
