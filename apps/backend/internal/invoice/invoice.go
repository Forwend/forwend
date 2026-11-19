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

// How long a checkout stays open (D-18).
const (
	DefaultExpiresIn = time.Hour
	MinExpiresIn     = 15 * time.Minute
	MaxExpiresIn     = 365 * 24 * time.Hour
	// SettleWindow runs from expiry to the settle deadline. Older invoices have 24 h; the term checks accept both.
	SettleWindow = 7 * 24 * time.Hour
)

var (
	ErrInvalid  = errors.New("invalid invoice request")
	ErrConflict = errors.New("idempotency key reused with another request")
	ErrNotFound = errors.New("invoice not found")
	// The worker's first scan starts at the finalized block, so an earlier payment would never be seen (SEC-02).
	ErrNotWatched = errors.New("network not watched yet")
	// A business invoice names who bills the client; a personal request names its sender.
	ErrBillingDetailsRequired = errors.New("billing details required")
)

// TooSoonError refuses a request until Wait passes: a shared budget or the spacing of one invoice's checks ran out.
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

// AgreedValue is the price agreed with the client in fiat, in the currency's minor units. Decimals are kept with it,
// so it reads right even if its currency later leaves AgreedCurrencies.
type AgreedValue struct {
	Currency string
	Amount   int64
	Decimals int
	Date     string // YYYY-MM-DD
}

// Line is a stored line, in the base units of the invoice's main option (the one whose id is the invoice's).
type Line struct {
	Description string
	Quantity    string // as stored, with 2 places: "7.50"
	UnitPrice   *big.Int
	Amount      *big.Int
}

// Details are what the invoice says besides its terms.
type Details struct {
	Title         string
	Note          string
	DueDate       string // YYYY-MM-DD; only shown: payment still closes at ClosesAt
	SupplyDate    string // YYYY-MM-DD: when the work was done or delivered
	Reference     string // the client's PO number or their reference
	Agreed        *AgreedValue
	ClientName    string
	ClientEmail   string
	ClientAddress string
	ClientCountry string // ISO 3166-1 alpha-2
	ClientTaxID   string
	SenderName    string // the name the payer sees when the invoice has no issuer, such as a personal request
	ReturnURL     string // an https link to the creator's site, offered to the payer once paid
	// Metadata is the creator's own keys and values; only the owner's reads return them.
	Metadata map[string]string
}

// With several options, the terms and statuses are the current option's: the chosen one, else the first.
type Invoice struct {
	Receipts []PaymentReceipt
	Details
	Purpose      Purpose
	DocumentKind DocumentKind
	LinkID       string
	Lines        []Line // set by Get
	// Issuer is a copy taken at creation; later billing changes don't reach it.
	Issuer         *profile.Issuer
	ID             string // the main row's on-chain id: keccak256 of PayToken
	PayToken       string // the pay link's secret (D-86); "" for an invoice older than pay tokens
	OptionID       string // the on-chain id of the terms below; ID for a fixed invoice
	OptionLocked   bool   // an option received money, so the payer can't pick another
	PickedOptionID string // "" before the payer picks an option
	OptionCount    int    // accepted options: 1 for a fixed invoice
	// Confirming: a payment before the close is seen, not final. A partly paid invoice stays confirming while the rest
	// confirms, since the database allows no way back to detected.
	Confirming bool
	// Closed: the checkout closed and the invoice can no longer be paid, before its status catches up (ClosedSQL).
	Closed      bool
	NextCheckAt time.Time // when Check status may run again; zero when it may now. Set by Get
	Options     []Option  // every accepted option, the current one included; set by Get
	// Number is per profile; nil for a document-free checkout, and for an older link invoice before its first deposit.
	Number           *int64
	chain.Asset      // Symbol and Decimals set by Get
	Amounts          *ledger.Amounts
	Amount           *big.Int
	Fees             Fees
	Recipient        string
	Factory          string
	ReceiveAddress   string
	ExpiresAt        time.Time
	ClosesAt         time.Time // the checkout's close: ExpiresAt, or the reopened one
	SettleDeadline   time.Time
	PaymentStatus    string
	SettlementStatus string
	RefundStatus     string
	SettlementTxHash string
	CreatedAt        time.Time
	Deposits         []Deposit // set by Get
	DepositSummary   *DepositSummary
	Network          string // the chain's name; set by Get
	// PaidAt is the block time of the deposit that completed the amount owed to the creator; set by Get once paid.
	PaidAt time.Time
	// SettledAt is when the settlement was booked as final; set by Get once settled.
	SettledAt  time.Time
	CanceledAt time.Time
	// SettlementWait says why a paid invoice's money hasn't reached the creator yet; nil when not waiting. Set by Get.
	SettlementWait *SettlementWait
	// Set by the owner's Get.
	Sends       []Send // oldest first
	Reminders   Reminders
	Retainer    *Retainer      // nil when it doesn't repeat
	History     []HistoryEvent // newest first
	Views       Views
	Memo        string
	Replaces    *Revision
	ReopenUntil time.Time // the close a reopen now gives; zero when it can't
	// Set by Get.
	Updates    []Update // edits the payer sees, newest first
	ReplacedBy *Revision
	// receiverDeployedAt is factory.deployedAt of the receiver, read when the option closed partly paid; nil before.
	receiverDeployedAt *int64
	// A merchant invoice's store; "" for a personal or freelancer profile's.
	StoreID, StoreName string
	BrandColor         string     // "" for none
	LogoAt             *time.Time // nil for none
	// Livemode is false on a testnet: test mode, whose tokens have no value.
	Livemode bool
	// CrossChain is the shown quote of a payment through NEAR Intents, nil without one. Set by Get.
	CrossChain *CrossChainPayment
	// CrossChainOn: its profile takes payments from other chains, and the platform didn't turn them off. Set by Get.
	CrossChainOn bool
	// State and Wallet are the merchant's reading of the statuses: PaymentStates and WalletStates.
	State, Wallet string
}

// Revision is the other invoice of a Revise; PayToken is set only for the replacement.
type Revision struct {
	ID       string
	Number   int64
	PayToken string
}

// Why a paid invoice still waits to settle.
const (
	WaitSigning    = "signing"    // the signer settles it on its next round
	WaitFinalizing = "finalizing" // the settle was sent; it counts once its block is final
	WaitRetrying   = "retrying"   // a temporary condition; the signer tries again at Until
	WaitDailyLimit = "dailyLimit" // the user's sponsored settlements for 24 hours are used up (SEC-03); next try at Until
	WaitRefused    = "refused"    // the signer refused the terms; an operator looks at it
)

// Until is set for retrying and dailyLimit; TimeLeft, an estimate, for finalizing.
type SettlementWait struct {
	Kind     string
	Until    time.Time
	TimeLeft time.Duration
}

// Who pays an invoice's fees.
const (
	FeesPaidByOwner  = "owner"  // deducted at settlement
	FeesPaidByClient = "client" // added on top of the price
)

// Fees are an option's contract fees and who pays them: the payer sends the amount, the owner receives the amount
// less both fees.
type Fees struct {
	Network, Platform *big.Int
	PaidBy            string
}

// Net is what the owner receives of amount.
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
	Deposits       []Deposit // set by Get
	DepositSummary *DepositSummary
	Amounts        *ledger.Amounts
	ClosesAt       time.Time
}

// Deposit is a non-reorged transfer to the receive address; Progress counts blocks until final.
type Deposit struct {
	TxHash      string
	LogIndex    uint64
	From        string // sender, lowercase hex
	Amount      *big.Int
	BlockNumber uint64
	BlockTime   time.Time
	Status      string // detected or confirmed
	Late        bool   // block time after the close (ClosesAt): held for the payer
	// Paid is the part the ledger booked to the creator; nil until booked. An expired partial payment keeps it,
	// though the expiry later holds that money for the payer.
	Paid *big.Int
	finality.Progress
	// BlocksTotal is the blocks it had to wait when first seen, at least BlocksLeft: the m of "Confirming (n/m)".
	BlocksTotal uint64
}
