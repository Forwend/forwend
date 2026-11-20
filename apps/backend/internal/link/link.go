// Package link keeps payment links: templates a payer pays through at /l/<slug>.
package link

import (
	"errors"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/jackc/pgx/v5/pgxpool"
)

const MaxPayments = 1_000_000

var (
	ErrInvalid  = errors.New("invalid payment link request")
	ErrNotFound = errors.New("payment link not found")
	ErrPersonal = errors.New("a personal profile has no payment links")
	ErrNotReady = errors.New("finish billing details, wallet setup and accepted tokens before activating this payment link")
)

// Link is a payment link; amounts are USD cents, and an open link has AmountCents 0.
type Link struct {
	ID          string
	StoreID     string
	Slug        string
	Title       string
	AmountCents int64
	MinCents    int64
	MaxCents    int64 // 0 for none, like MinCents
	EndsAt      *time.Time
	MaxPayments int // 0 for no cap
	Active      bool
	Livemode    bool
	FeesPaidBy  string // "" for the profile's choice
	Visits      int64
	Paid        int64
	Reserved    int64
	Ready       bool
	Revision    int64
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Details are what the owner sets; amounts are USD decimals like "12.50", "" for none.
type Details struct {
	Livemode    *bool
	Title       string
	StoreID     string
	AmountUSD   string
	MinUSD      string
	MaxUSD      string
	EndsAt      *time.Time
	MaxPayments *int // nil for no cap
	Active      bool
	FeesPaidBy  string // "" for the profile's choice
}

type Service struct {
	pool     *pgxpool.Pool
	invoices *invoice.Service
}

func NewService(pool *pgxpool.Pool, invoices *invoice.Service) *Service {
	return &Service{pool: pool, invoices: invoices}
}
