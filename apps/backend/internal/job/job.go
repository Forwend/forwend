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
	ErrInvalid  = errors.New("invalid job request")
	ErrConflict = errors.New("idempotency key reused with another request")
	// ErrAccepted: the client accepted the job, so it can't be deleted.
	ErrAccepted    = errors.New("the client accepted the job")
	ErrNotAccepted = errors.New("the client has not accepted the job")
	// ErrOutOfOrder: the steps are marked done in order, and an earlier payment has no invoice yet.
	ErrOutOfOrder        = errors.New("an earlier payment has no invoice yet")
	ErrChangeNotAccepted = errors.New("the client has not accepted this change")
	// One change waits for the client at a time, and the final invoice waits until none does.
	ErrChangePending = errors.New("a change waits for the client's acceptance")
	// ErrJobFinished: the last payment is done, so more work is a new job.
	ErrJobFinished     = errors.New("the job's last payment is done")
	ErrNotWithdrawable = errors.New("only the last payment, a change not accepted yet, can be withdrawn")
)

// Client needs a name and an email: payments are billed there.
type Request struct {
	Title    string
	Scope    string
	Client   profile.ClientDetails
	Payments []PaymentRequest
}

// AmountUSD has at most 2 decimals. Only the first payment may be OnAccept, the deposit.
type PaymentRequest struct {
	Title     string
	AmountUSD string
	DueDays   int
	OnAccept  bool
}

type Payment struct {
	Position    int
	Title       string
	AmountCents int64
	DueDays     int
	OnAccept    bool
	InvoiceID   string // "" until made
	PayToken    string // its pay link's token (D-86); "" until made
	Number      int64
	Status      string // the invoice's status filter (invoice.StatusFilterSQL); "" until made
	// When the owner marked the step done, and the link to what was delivered (R-103); zero and "" until then. The
	// deposit is made at acceptance, so it has neither.
	DoneAt       time.Time
	DeliveryLink string
	// For the job's record (R-104): PaidAt is the block time of the payment that completed it; zero until then.
	InvoicedAt time.Time
	PaidAt     time.Time
	// A scope change (R-105); zero and "" for the payments of the quote.
	ProposedAt    time.Time
	AcceptedName  string
	AcceptedEmail string
	AcceptedAt    time.Time
	// ClientEmailed: an email about this change was queued for the client (R-107); false past the daily caps.
	ClientEmailed bool
}

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

func USD(cents int64) string {
	return fmt.Sprintf("%d.%02d", cents/100, cents%100)
}

// TotalCents counts a change only once the client accepted it (R-105).
func (j Job) TotalCents() int64 {
	var total int64
	for _, p := range j.Payments {
		if p.ProposedAt.IsZero() || !p.AcceptedAt.IsZero() {
			total += p.AmountCents
		}
	}
	return total
}

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
