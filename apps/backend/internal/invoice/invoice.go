// Package invoice creates invoices with a locally computed receive address and reads them back.
package invoice

import (
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/finality"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/profile"
)

const (
	DefaultExpiresIn = time.Hour
	MinExpiresIn     = 15 * time.Minute
	MaxExpiresIn     = 365 * 24 * time.Hour
	// SettleWindow runs from expiry to the settle deadline; older invoices have 24 h and checks accept both.
	SettleWindow = 7 * 24 * time.Hour
)

var (
	ErrInvalid  = errors.New("invalid invoice request")
	ErrConflict = errors.New("idempotency key reused with another request")
	ErrNotFound = errors.New("invoice not found")
	// A scan starts at the finalized block, so an earlier payment would never be seen.
	ErrNotWatched             = errors.New("network not watched yet")
	ErrBillingDetailsRequired = errors.New("billing details required")
)

// TooSoonError: a shared budget or one invoice's check spacing ran out; retry after Wait.
type TooSoonError struct{ Wait time.Duration }

func (e *TooSoonError) Error() string { return fmt.Sprintf("checked recently: wait %s", e.Wait) }

type Purpose string

const (
	PurposeInvoice  Purpose = "invoice"
	PurposeCheckout Purpose = "checkout"
	PurposeRequest  Purpose = "request"
)

type DocumentKind string

const (
	DocumentInvoice DocumentKind = "invoice"
	DocumentRequest DocumentKind = "request"
	DocumentNone    DocumentKind = "none"
)

// AgreedValue is the fiat price agreed with the client, in the currency's minor units.
type AgreedValue struct {
	Currency string
	Amount   int64
	Decimals int    // stored, so it reads right if the currency is dropped
	Date     string // YYYY-MM-DD
}

// Line amounts are in the base units of the invoice's main option.
type Line struct {
	Description string
	Quantity    string // as stored, with 2 places: "7.50"
	UnitPrice   *big.Int
	Amount      *big.Int
}

type Details struct {
	Title         string
	Note          string
	DueDate       string // YYYY-MM-DD; only shown: payment still closes at ClosesAt
	SupplyDate    string // YYYY-MM-DD
	Reference     string
	Agreed        *AgreedValue
	ClientName    string
	ClientEmail   string
	ClientAddress string
	ClientCountry string // ISO 3166-1 alpha-2
	ClientTaxID   string
	SenderName    string // shown when there is no issuer
	ReturnURL     string
	Metadata      map[string]string // only the owner's reads return it
}

// Invoice terms and statuses are the current option's: the chosen one, else the first.
type Invoice struct {
	Receipts []PaymentReceipt
	Details
	Purpose        Purpose
	DocumentKind   DocumentKind
	LinkID         string
	Lines          []Line
	Issuer         *profile.Issuer // copied at creation
	ID             string          // on-chain id: keccak256 of PayToken
	PayToken       string          // the pay link's secret; "" on old invoices
	OptionID       string
	OptionLocked   bool
	PickedOptionID string
	OptionCount    int
	Confirming     bool      // a payment is seen, not final
	Closed         bool      // can't be paid; the status may lag (ClosedSQL)
	NextCheckAt    time.Time // zero when Check status may run now
	Options        []Option
	Number         *int64 // per profile; nil without a document
	chain.Asset
	Amounts            *ledger.Amounts
	Amount             *big.Int
	Fees               Fees
	Recipient          string
	Factory            string
	ReceiveAddress     string
	ExpiresAt          time.Time
	ClosesAt           time.Time // ExpiresAt, or the reopened close
	SettleDeadline     time.Time
	PaymentStatus      string
	SettlementStatus   string
	RefundStatus       string
	SettlementTxHash   string
	CreatedAt          time.Time
	Deposits           []Deposit
	DepositSummary     *DepositSummary
	Network            string
	PaidAt             time.Time
	SettledAt          time.Time
	CanceledAt         time.Time
	SettlementWait     *SettlementWait
	Sends              []Send
	Reminders          Reminders
	Retainer           *Retainer
	History            []HistoryEvent
	Views              Views
	Memo               string
	Replaces           *Revision
	ReopenUntil        time.Time // the close a reopen now gives; zero when it can't
	Updates            []Update
	ReplacedBy         *Revision
	receiverDeployedAt *int64 // factory.deployedAt; read once closed partly paid
	StoreID, StoreName string
	BrandColor         string
	LogoAt             *time.Time
	Livemode           bool
	CrossChain         *CrossChainPayment
	CrossChainOn       bool // the profile's switch, unless the platform's is off
	State, Wallet      string
}

type Revision struct {
	ID       string
	Number   int64
	PayToken string // only for the replacement
}

// Why a paid invoice still waits to settle.
const (
	WaitSigning    = "signing"    // the signer's next round
	WaitFinalizing = "finalizing" // sent; counts once its block is final
	WaitRetrying   = "retrying"   // tried again at Until
	WaitDailyLimit = "dailyLimit" // 24-hour sponsored settlements used up; next at Until
	WaitRefused    = "refused"    // an operator looks at it
)

type SettlementWait struct {
	Kind     string
	Until    time.Time     // retrying and dailyLimit
	TimeLeft time.Duration // an estimate, for finalizing
}

const (
	FeesPaidByOwner  = "owner"  // deducted at settlement
	FeesPaidByClient = "client" // added on top of the price
)

// Fees: the payer sends the amount; the owner receives it less both fees.
type Fees struct {
	Network, Platform *big.Int
	PaidBy            string
}

func (f Fees) Net(amount *big.Int) *big.Int {
	return new(big.Int).Sub(amount, new(big.Int).Add(f.Network, f.Platform))
}

func scanFees(network, platform, paidBy string) Fees {
	f := Fees{PaidBy: paidBy}
	f.Network, _ = new(big.Int).SetString(network, 10)
	f.Platform, _ = new(big.Int).SetString(platform, 10)
	return f
}

// Option is one accepted token and network; recipient, expiry and settle deadline are the invoice's.
type Option struct {
	ID string
	chain.Asset
	Network        string
	Amount         *big.Int
	Fees           Fees
	ReceiveAddress string
	Deposits       []Deposit
	DepositSummary *DepositSummary
	Amounts        *ledger.Amounts
	ClosesAt       time.Time
}

// Deposit is a non-reorged transfer to the receive address.
type Deposit struct {
	TxHash      string
	LogIndex    uint64
	From        string // lowercase hex
	Amount      *big.Int
	BlockNumber uint64
	BlockTime   time.Time
	Status      string   // detected or confirmed
	Late        bool     // after the close: held for the payer
	Paid        *big.Int // booked to the creator; nil until booked
	finality.Progress
	BlocksTotal uint64 // the m of "Confirming (n/m)"
}
