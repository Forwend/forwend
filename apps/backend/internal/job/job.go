// Package job holds jobs (R-100, D-81): a quote with a payment schedule that the client accepts by link. Each payment
// becomes a normal invoice: the deposit when the client accepts.
package job

import (
	"errors"
	"fmt"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

const (
	MaxTitle    = 200
	MaxScope    = 5000
	MaxPayments = 10
	// MaxPaymentTitle leaves the invoice line it becomes room to spare (R-88).
	MaxPaymentTitle = 100
	// MaxDueDays keeps a payment's checkout, open 60 days past its due date (D-80), within a year (D-18).
	MaxDueDays = 90
	// MaxJobs is per profile; the list is read whole.
	MaxJobs = 1000
)

var (
	ErrNotFound = errors.New("job not found")
	// ErrInvalid wraps a request value that breaks a rule; the message names it.
	ErrInvalid = errors.New("invalid job request")
	// ErrConflict means the idempotency key was used with another request.
	ErrConflict = errors.New("idempotency key reused with another request")
)

// Request is a new job as the owner sends it. Client needs a name and an email: payments are billed there.
type Request struct {
	Title    string
	Scope    string
	Client   profile.ClientDetails
	Payments []PaymentRequest
}

// PaymentRequest is one payment of the schedule: AmountUSD is a decimal with at most 2 decimals. Only the first may be
// OnAccept, the deposit.
type PaymentRequest struct {
	Title     string
	AmountUSD string
	DueDays   int
	OnAccept  bool
}

// Payment is one payment of a job's schedule; its invoice is set once made.
type Payment struct {
	Position    int
	Title       string
	AmountCents int64
	DueDays     int
	OnAccept    bool
	InvoiceID   string // "" until made
	Number      int64
	Status      string // the invoice's status filter (invoice.StatusFilterSQL); "" until made
}

// Job is a quote and what came of it. The client's typed name and email are set once accepted.
type Job struct {
	ID            string
	Token         string // the secret in the client's link /w/<token>
	Title         string
	Scope         string
	Client        profile.ClientDetails
	Issuer        profile.Issuer
	Payments      []Payment
	AcceptedName  string
	AcceptedEmail string
	AcceptedAt    time.Time
	CreatedAt     time.Time
	profileID     string
}

// USD is cents as a decimal with 2 decimals, like 300.00.
func USD(cents int64) string {
	return fmt.Sprintf("%d.%02d", cents/100, cents%100)
}

// TotalCents is what the whole job costs: the sum of its payments.
func (j Job) TotalCents() int64 {
	var total int64
	for _, p := range j.Payments {
		total += p.AmountCents
	}
	return total
}

// Summary is a job in the owner's list.
type Summary struct {
	ID         string
	Title      string
	ClientName string
	TotalCents int64
	Payments   int
	Paid       int // payments whose invoice is paid or settled
	AcceptedAt time.Time
	CreatedAt  time.Time
}
