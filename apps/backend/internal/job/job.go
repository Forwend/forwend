// Package job holds quotes with a payment schedule that the client accepts by link; each payment becomes an invoice.
package job

import (
	"errors"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/profile"
)

const (
	MaxTitle        = 200
	MaxScope        = 5000
	MaxPayments     = 10
	MaxPaymentTitle = 100
	MaxDueDays      = 90   // plus 60 days' grace keeps a checkout within a year
	MaxJobs         = 1000 // per profile
)

var (
	ErrNotFound          = errors.New("job not found")
	ErrInvalid           = errors.New("invalid job request")
	ErrConflict          = errors.New("idempotency key reused with another request")
	ErrAccepted          = errors.New("the client accepted the job")
	ErrNotAccepted       = errors.New("the client has not accepted the job")
	ErrOutOfOrder        = errors.New("an earlier payment has no invoice yet")
	ErrChangeNotAccepted = errors.New("the client has not accepted this change")
	ErrChangePending     = errors.New("a change waits for the client's acceptance")
	ErrJobFinished       = errors.New("the job's last payment is done")
	ErrNotWithdrawable   = errors.New("only the last payment, a change not accepted yet, can be withdrawn")
)

type Request struct {
	Title    string
	Scope    string
	Client   profile.ClientDetails
	Payments []PaymentRequest
}

// AmountUSD has at most 2 decimals; only the first payment, the deposit, may be OnAccept.
type PaymentRequest struct {
	Title     string
	AmountUSD string
	DueDays   int
	OnAccept  bool
}

type Payment struct {
	Position      int
	Title         string
	AmountCents   int64
	DueDays       int
	OnAccept      bool
	InvoiceID     string // "" until made
	PayToken      string
	Number        int64
	Status        string    // invoice.StatusFilterSQL value; "" until made
	DoneAt        time.Time // zero until done; never set on the deposit
	DeliveryLink  string
	InvoicedAt    time.Time
	PaidAt        time.Time // block time of the completing payment
	ProposedAt    time.Time // zero for the quote's own payments
	AcceptedName  string
	AcceptedEmail string
	AcceptedAt    time.Time
	ClientEmailed bool
}

type Job struct {
	ID            string
	Token         string // secret in the client's link /w/<token>
	Title         string
	Scope         string
	Client        profile.ClientDetails
	Issuer        profile.Issuer
	Payments      []Payment
	AcceptedName  string
	AcceptedEmail string
	AcceptedAt    time.Time
	CreatedAt     time.Time
	Livemode      bool
	profileID     string
}

// TotalCents counts a change only once the client accepted it.
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
