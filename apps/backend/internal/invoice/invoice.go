// Package invoice creates invoices with a locally computed receive address (R-19) and reads them back.
package invoice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/finality"
	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

// D-18.
const (
	DefaultExpiresIn = time.Hour
	MinExpiresIn     = 15 * time.Minute
	MaxExpiresIn     = 365 * 24 * time.Hour
	// D-18: from expiry to the settle deadline. Invoices made before this window have 24 h; the term checks accept both.
	SettleWindow = 7 * 24 * time.Hour
)

// Longest details, in characters (R-42).
const (
	MaxTitle      = 200
	MaxNote       = 2000
	MaxSenderName = 100
	MaxReturnURL  = 2000
)

// Each watched receive address is in every scan until 30 days after its settle deadline.
const (
	MaxOpen   = 1000
	MaxPerDay = 500
)

var (
	ErrInvalid  = errors.New("invalid invoice request")
	ErrConflict = errors.New("idempotency key reused with another request")
	ErrNotFound = errors.New("invoice not found")
	// The worker's first scan starts at the finalized block, so an earlier payment would never be seen (SEC-02).
	ErrNotWatched = errors.New("network not watched yet")
	// A business invoice names who bills the client (R-92, D-83); a personal request names its sender (D-52).
	ErrBillingDetailsRequired = errors.New("billing details required")
)

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

var (
	evmAddress = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
	digits     = regexp.MustCompile(`^[0-9]+$`)
	usdAmount  = regexp.MustCompile(`^[0-9]{1,60}(\.[0-9]{1,18})?$`)
	quantity   = regexp.MustCompile(`^[0-9]{1,7}(\.[0-9]{1,2})?$`)
	uint256Max = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
)

// A fixed invoice sets ChainID, Token and Amount in base units; payer chooses (R-56) sets only AmountUSD,
// a decimal like "12.50", paid in any enabled token at 1 USD each (D-75).
type Request struct {
	// Purpose is set only by dedicated checkout operations. Empty preserves legacy creation and replay semantics.
	Purpose          Purpose `json:"-"`
	ChainID          uint64
	Token            string
	Amount           string
	AmountUSD        string
	ExpiresInSeconds *int64
	Details
	// Lines add up exactly to the amount (R-88). UnitPrice is in the amount's unit:
	// base units with Amount, a USD decimal with AmountUSD.
	Lines []LineRequest
	// Agreed is the price agreed with the client in fiat (R-93), as typed.
	Agreed *AgreedRequest
	// R-97: needs a due date and a client email.
	Reminders bool
	// R-98: monthly; needs a due date and a client email.
	Repeat *Repeat
	// R-129: the profile's invoice this one replaces, canceled in the same transaction.
	Replaces string
	cycle    *cycle
	// R-134: a merchant invoice's store; "" is the profile's first store.
	StoreID string
	// Stores, when not nil, are the only stores a Developer or Finance member reaches (R-138): Replaces must be in one.
	Stores []string `json:"-"`
	// Livemode requires the mode of an API key or payment link (D-87).
	Livemode *bool `json:"-"`
	// After runs in the insert's transaction before commit, and not on an idempotent replay (R-100).
	After func(ctx context.Context, tx pgx.Tx, invoiceID string) error `json:"-"`
	// Before checks source-specific constraints under the profile lock, before the public request budget is spent.
	Before func(ctx context.Context, tx pgx.Tx) error `json:"-"`
	// By is who makes the invoice, for its history (R-123); empty is the owner.
	By history.Actor `json:"-"`
	// LinkID is the payment link a payer made it from: it has no number until its first deposit (R-141).
	LinkID string `json:"-"`
	// Allow, when set, is asked just before the insert, so a refused or replayed create spends none of a public
	// caller's shared budget (R-117).
	Allow func() time.Duration `json:"-"`
}

type AgreedRequest struct {
	Currency string
	Amount   string // a decimal with at most the currency's decimals, like "1000.50"
	Date     string // YYYY-MM-DD
}

// AgreedValue is the price agreed with the client in fiat (R-93), in the currency's minor units (cents). Decimals are
// kept with it, so it reads right even if its currency later leaves AgreedCurrencies.
type AgreedValue struct {
	Currency string
	Amount   int64
	Decimals int
	Date     string // YYYY-MM-DD
}

// EUR and the ECB's daily reference-rate currencies, with ISO 4217 decimals (D-82).
// The web keeps a copy; a test fails when they differ.
var AgreedCurrencies = map[string]int{
	"EUR": 2, "USD": 2, "GBP": 2, "AUD": 2, "BRL": 2, "CAD": 2, "CHF": 2, "CNY": 2, "CZK": 2, "DKK": 2, "HKD": 2,
	"HUF": 2, "IDR": 2, "ILS": 2, "INR": 2, "ISK": 0, "JPY": 0, "KRW": 0, "MXN": 2, "MYR": 2, "NOK": 2, "NZD": 2,
	"PHP": 2, "PLN": 2, "RON": 2, "SEK": 2, "SGD": 2, "THB": 2, "TRY": 2, "ZAR": 2,
}

// agreedAmount is a decimal of up to 12 whole digits, so its minor units fit an int64.
var agreedAmount = regexp.MustCompile(`^([0-9]{1,12})(?:\.([0-9]+))?$`)

func (a *AgreedRequest) parse() (*AgreedValue, error) {
	if a == nil {
		return nil, nil
	}
	digits, ok := AgreedCurrencies[a.Currency]
	if !ok {
		return nil, fmt.Errorf("%w: agreedValue.currency must be EUR or a currency the ECB publishes a rate for, like GBP",
			ErrInvalid)
	}
	m := agreedAmount.FindStringSubmatch(a.Amount)
	if m == nil || len(m[2]) > digits {
		return nil, fmt.Errorf("%w: agreedValue.amount must be a decimal with at most %d decimals for %s", ErrInvalid,
			digits, a.Currency)
	}
	minor, _ := strconv.ParseInt(m[1]+m[2]+strings.Repeat("0", digits-len(m[2])), 10, 64)
	if minor == 0 {
		return nil, fmt.Errorf("%w: agreedValue.amount must be above 0", ErrInvalid)
	}
	// Postgres has no year 0.
	if day, err := time.Parse(time.DateOnly, a.Date); err != nil || day.Year() < 1 {
		return nil, fmt.Errorf("%w: agreedValue.date must be a date like 2026-10-17", ErrInvalid)
	}
	return &AgreedValue{Currency: a.Currency, Amount: minor, Decimals: digits, Date: a.Date}, nil
}

type LineRequest struct {
	Description string
	Quantity    string // a decimal with up to 2 places, like "7.5"
	UnitPrice   string
}

// Line is a stored line, in the base units of the invoice's main option (the one whose id is the invoice's).
type Line struct {
	Description string
	Quantity    string // as stored, with 2 places: "7.50"
	UnitPrice   *big.Int
	Amount      *big.Int
}

// R-88.
const (
	MaxLines           = 50
	MaxLineDescription = 200
)

type line struct {
	description string
	quantity    *big.Rat
	price       *big.Rat
}

// Details are what the invoice says besides its terms. Like the terms, they never change.
type Details struct {
	Title         string
	Note          string
	DueDate       string // YYYY-MM-DD; only shown: payment still closes at ClosesAt
	SupplyDate    string // YYYY-MM-DD: when the work was done or delivered (R-89)
	Reference     string // the client's PO number or their reference (R-90)
	Agreed        *AgreedValue
	ClientName    string
	ClientEmail   string
	ClientAddress string
	ClientCountry string // ISO 3166-1 alpha-2
	ClientTaxID   string
	SenderName    string // the name the payer sees when the invoice has no issuer, such as a personal request (D-52)
	ReturnURL     string // an https link to the creator's site, offered to the payer once paid (R-58)
	// The creator's own keys and values (R-151), set at create; only the owner's reads return them.
	Metadata map[string]string
}

// Metadata limits (D-101).
const (
	MaxMetadataKeys  = 20
	MaxMetadataValue = 500
)

var metadataKey = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)

// With several options, the terms and statuses are the current option's: the chosen one, else the first.
type Invoice struct {
	Details
	Purpose      Purpose
	DocumentKind DocumentKind
	LinkID       string
	Lines        []Line // set by Get
	// A copy taken at creation; later billing changes don't reach it.
	Issuer       *profile.Issuer
	ID           string // the main row's on-chain id: keccak256 of PayToken
	PayToken     string // the pay link's secret (D-86); "" for an invoice made before it
	OptionID     string // the on-chain id of the terms below; ID for a fixed invoice
	OptionLocked bool   // an option received money, so the payer can't pick another
	OptionCount  int    // accepted options: 1 for a fixed invoice
	// Confirming: a payment before the close is seen, not final. A partly paid invoice stays confirming while the rest
	// confirms, since the database allows no way back to detected (R-69).
	Confirming bool
	// Closed: the checkout closed and the invoice can no longer be paid, before its status catches up (ClosedSQL).
	Closed           bool
	NextCheckAt      time.Time // when Check status may run again; zero when it may now. Set by Get
	Options          []Option  // every accepted option, the current one included; set by Get
	Number           *int64    // per profile; nil for document-free checkout and legacy link attempts before their first deposit
	chain.Asset                // Symbol and Decimals set by Get
	Amount           *big.Int
	Recipient        string
	Factory          string
	ReceiveAddress   string
	ExpiresAt        time.Time
	ClosesAt         time.Time // the checkout's close: ExpiresAt, or the reopened one (R-130)
	SettleDeadline   time.Time
	PaymentStatus    string
	SettlementStatus string
	RefundStatus     string
	SettlementTxHash string
	CreatedAt        time.Time
	Deposits         []Deposit // set by Get
	Network          string    // the chain's name; set by Get
	// PaidAt is the block time of the deposit that completed the amount owed to the creator; set by Get once paid.
	PaidAt time.Time
	// SettledAt is when the settlement was booked as final, from the ledger; set by Get once settled.
	SettledAt time.Time
	// CanceledAt is when the owner canceled it (R-79); zero otherwise.
	CanceledAt time.Time
	// Why a paid invoice's money hasn't reached the creator yet; nil when not waiting. Set by Get.
	SettlementWait *SettlementWait
	Sends          []Send         // the owner's Send to client, oldest first (R-94); set by the owner's Get
	Reminders      Reminders      // payment reminders (R-96); set by the owner's Get
	Retainer       *Retainer      // the retainer it belongs to (R-98), nil when it doesn't repeat; set by the owner's Get
	History        []HistoryEvent // newest first (R-124); set by the owner's Get
	Views          Views          // pay page loads (R-125); set by the owner's Get
	Memo           string         // the owner's own note (R-127); set by the owner's Get
	Updates        []Update       // edits the payer sees, newest first (R-128); set by Get
	ReplacedBy     *Revision      // the invoice a Revise replaced it with (R-129); set by Get
	Replaces       *Revision      // the invoice it replaced (R-129); set by the owner's Get
	ReopenUntil    time.Time      // the close a reopen now gives (R-130); zero when it can't; set by the owner's Get
	// factory.deployedAt of the receiver, read when the option closed partly paid (R-130); nil before
	receiverDeployedAt *int64
	// A merchant invoice's store (R-134); "" for a personal or freelancer profile's.
	StoreID, StoreName string
	// The store's accent color ("" none) and when its logo was saved (nil none) (R-135).
	BrandColor string
	LogoAt     *time.Time
	// Livemode is false on a testnet: test mode, whose tokens have no value (D-87).
	Livemode bool
}

// Revision is the other invoice of a Revise (R-129); PayToken is set only for the replacement.
type Revision struct {
	ID       string
	Number   int64
	PayToken string
}

// Why a paid invoice still waits to settle (R-54).
const (
	WaitSigning    = "signing"    // the signer settles it on its next round
	WaitFinalizing = "finalizing" // the settle was sent; it counts once its block is final (D-45)
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

// Option is one accepted token and network; recipient, expiry and settle deadline are the invoice's.
type Option struct {
	ID string
	chain.Asset
	Network        string
	Amount         *big.Int
	ReceiveAddress string
	Deposits       []Deposit // set by Get
}

// Deposit is a non-reorged transfer to the receive address; Progress counts blocks until final (R-28).
type Deposit struct {
	TxHash      string
	LogIndex    uint64
	From        string // sender, lowercase hex
	Amount      *big.Int
	BlockNumber uint64
	BlockTime   time.Time
	Status      string // detected or confirmed
	Late        bool   // block time after the close (ClosesAt): held for the payer (D-26)
	// Paid is the part the ledger booked to the creator (R-121); nil until booked. An expired partial payment
	// keeps it, though the expiry later holds that money for the payer.
	Paid *big.Int
	finality.Progress
	// BlocksTotal is the blocks it had to wait when first seen, at least BlocksLeft: the m of "Confirming (n/m)" (R-73).
	BlocksTotal uint64
}

func (r Request) normalize() (token string, amount *big.Int, usd *big.Rat, lines []line, expiresIn time.Duration, err error) {
	if r.AmountUSD != "" {
		if r.ChainID != 0 || r.Token != "" || r.Amount != "" {
			return "", nil, nil, nil, 0, fmt.Errorf("%w: send amountUsd alone, or chainId, token and amount", ErrInvalid)
		}
		// Pattern first: parsing a huge string costs CPU.
		if usdAmount.MatchString(r.AmountUSD) {
			usd, _ = new(big.Rat).SetString(r.AmountUSD)
		}
		if usd == nil || usd.Sign() == 0 {
			return "", nil, nil, nil, 0, fmt.Errorf("%w: amountUsd must be a decimal like 12.50, above 0", ErrInvalid)
		}
	} else {
		if r.ChainID == 0 || r.ChainID > math.MaxInt64 { // stored as bigint
			return "", nil, nil, nil, 0, fmt.Errorf("%w: chainId must be from 1 to 2^63-1", ErrInvalid)
		}
		if !evmAddress.MatchString(r.Token) {
			return "", nil, nil, nil, 0, fmt.Errorf("%w: token must be a 0x-prefixed 20-byte hex address", ErrInvalid)
		}
		// Length and digits first: parsing a huge string costs CPU. 2^256-1 has 78 digits.
		if len(r.Amount) > 78 || !digits.MatchString(r.Amount) {
			return "", nil, nil, nil, 0, fmt.Errorf("%w: amount must be a decimal string from 1 to 2^256-1", ErrInvalid)
		}
		amount, _ = new(big.Int).SetString(r.Amount, 10)
		if amount.Sign() == 0 || amount.Cmp(uint256Max) > 0 {
			return "", nil, nil, nil, 0, fmt.Errorf("%w: amount must be a decimal string from 1 to 2^256-1", ErrInvalid)
		}
	}
	expiresIn = DefaultExpiresIn
	if r.ExpiresInSeconds != nil {
		// Checked in seconds first, so a huge value can't overflow the Duration.
		if s := *r.ExpiresInSeconds; s < int64(MinExpiresIn/time.Second) || s > int64(MaxExpiresIn/time.Second) {
			return "", nil, nil, nil, 0, fmt.Errorf("%w: expiresIn must be seconds from 900 to 31536000", ErrInvalid)
		}
		expiresIn = time.Duration(*r.ExpiresInSeconds) * time.Second
	}
	if err := r.Details.check(); err != nil {
		return "", nil, nil, nil, 0, err
	}
	total := usd
	if total == nil {
		total = new(big.Rat).SetInt(amount)
	}
	if lines, err = checkLines(r.Lines, usd != nil, total); err != nil {
		return "", nil, nil, nil, 0, err
	}
	return strings.ToLower(r.Token), amount, usd, lines, expiresIn, nil
}

func checkLines(in []LineRequest, usd bool, total *big.Rat) ([]line, error) {
	if len(in) == 0 {
		return nil, nil
	}
	if len(in) > MaxLines {
		return nil, fmt.Errorf("%w: lines must be at most %d", ErrInvalid, MaxLines)
	}
	sum := new(big.Rat)
	out := make([]line, 0, len(in))
	for _, l := range in {
		if l.Description == "" || !utf8.ValidString(l.Description) ||
			utf8.RuneCountInString(l.Description) > MaxLineDescription || !profile.PlainText(l.Description, false) {
			return nil, fmt.Errorf("%w: lines need a description of at most %d characters of plain text", ErrInvalid,
				MaxLineDescription)
		}
		// Patterns first: parsing a huge string costs CPU.
		var q, p *big.Rat
		if quantity.MatchString(l.Quantity) {
			q, _ = new(big.Rat).SetString(l.Quantity)
		}
		if q == nil || q.Sign() == 0 || q.Cmp(big.NewRat(1_000_000, 1)) > 0 {
			return nil, fmt.Errorf("%w: lines need a quantity above 0 and at most 1000000, with up to 2 decimals", ErrInvalid)
		}
		if (usd && usdAmount.MatchString(l.UnitPrice)) || (!usd && len(l.UnitPrice) <= 78 && digits.MatchString(l.UnitPrice)) {
			p, _ = new(big.Rat).SetString(l.UnitPrice)
		}
		if p == nil {
			unit := "base units, like amount"
			if usd {
				unit = "a decimal like 12.50, like amountUsd"
			}
			return nil, fmt.Errorf("%w: lines need a unitPrice in %s", ErrInvalid, unit)
		}
		amount := new(big.Rat).Mul(q, p)
		if !usd && !amount.IsInt() {
			return nil, fmt.Errorf("%w: lines need a quantity times unitPrice that is a whole number of base units", ErrInvalid)
		}
		sum.Add(sum, amount)
		out = append(out, line{description: l.Description, quantity: q, price: p})
	}
	if sum.Cmp(total) != 0 {
		return nil, fmt.Errorf("%w: lines must add up exactly to the amount", ErrInvalid)
	}
	return out, nil
}

// usdUnits converts at 1 USD per token (D-75); nil when the decimals can't hold it exactly or it passes 2^256-1.
func usdUnits(usd *big.Rat, decimals int) *big.Int {
	n := new(big.Rat).Mul(usd, new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)))
	if !n.IsInt() || n.Num().Cmp(uint256Max) > 0 {
		return nil
	}
	return n.Num()
}

func (d Details) check() error {
	for _, f := range []struct {
		name, value string
		max         int
		lines       bool
	}{
		{"title", d.Title, MaxTitle, false}, {"note", d.Note, MaxNote, true},
		{"senderName", d.SenderName, MaxSenderName, false}, {"reference", d.Reference, profile.MaxClientReference, false},
	} {
		// Postgres text can't hold a NUL byte.
		if !utf8.ValidString(f.value) || utf8.RuneCountInString(f.value) > f.max || !profile.PlainText(f.value, f.lines) {
			return fmt.Errorf("%w: %s must be at most %d characters of plain text", ErrInvalid, f.name, f.max)
		}
	}
	if profile.Impersonates(d.SenderName) {
		return fmt.Errorf("%w: senderName can't name Forwend", ErrInvalid)
	}
	// A saved client's rules (R-86), so a client copied from the list always fits.
	client := profile.ClientDetails{Name: d.ClientName, Email: d.ClientEmail, Address: d.ClientAddress,
		Country: d.ClientCountry, TaxID: d.ClientTaxID}
	if p := client.Problem("client."); p != "" {
		return fmt.Errorf("%w: %s", ErrInvalid, p)
	}
	if d.ReturnURL != "" {
		u, err := url.Parse(d.ReturnURL)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || len(d.ReturnURL) > MaxReturnURL ||
			!profile.PlainText(d.ReturnURL, false) {
			return fmt.Errorf("%w: returnUrl must be an https link of at most %d characters", ErrInvalid, MaxReturnURL)
		}
	}
	badMetadata := len(d.Metadata) > MaxMetadataKeys
	for k, v := range d.Metadata {
		badMetadata = badMetadata || !metadataKey.MatchString(k) || !utf8.ValidString(v) ||
			utf8.RuneCountInString(v) > MaxMetadataValue || !profile.PlainText(v, false)
	}
	if badMetadata {
		return fmt.Errorf("%w: metadata must hold at most %d keys of 1 to 40 letters, digits, _ or -, each with plain "+
			"text on one line of at most %d characters", ErrInvalid, MaxMetadataKeys, MaxMetadataValue)
	}
	for _, f := range []struct{ name, value string }{{"dueDate", d.DueDate}, {"supplyDate", d.SupplyDate}} {
		// Postgres has no year 0.
		if day, err := time.Parse(time.DateOnly, f.value); f.value != "" && (err != nil || day.Year() < 1) {
			return fmt.Errorf("%w: %s must be a date like 2026-11-01", ErrInvalid, f.name)
		}
	}
	return nil
}

// requestHash fingerprints the canonical request, so the same values sent again match and the body is never stored.
// %q keeps the texts apart whatever they contain.
func requestHash(chainID uint64, token string, amount fmt.Stringer, expiresIn time.Duration, d Details, lines []line,
	reminders bool, repeat *Repeat, replaces, storeID string) []byte {
	b := fmt.Appendf(nil, "%d|%s|%s|%d|%q|%q|%q|%q|%q|%q|%q", chainID, token, amount,
		int64(expiresIn/time.Second), d.Title, d.Note, d.DueDate, d.ClientName, d.ClientEmail, d.ClientAddress,
		d.SenderName)
	if d.ReturnURL != "" { // added only when set, so requests made before it hash as they did
		b = fmt.Appendf(b, "|%q", d.ReturnURL)
	}
	if d.ClientCountry != "" || d.ClientTaxID != "" { // the same for the client's country and tax ID
		b = fmt.Appendf(b, "|%q|%q", d.ClientCountry, d.ClientTaxID)
	}
	if d.SupplyDate != "" { // named, so it can't read as one of the parts above
		b = fmt.Appendf(b, "|supplyDate=%q", d.SupplyDate)
	}
	if d.Reference != "" {
		b = fmt.Appendf(b, "|reference=%q", d.Reference)
	}
	if len(d.Metadata) > 0 {
		keys, _ := json.Marshal(d.Metadata) // sorted by key: the same metadata hashes the same
		b = fmt.Appendf(b, "|metadata=%s", keys)
	}
	if a := d.Agreed; a != nil { // in minor units: "1000" and "1000.00" EUR are the same price
		b = fmt.Appendf(b, "|agreedValue=%q|%d|%q", a.Currency, a.Amount, a.Date)
	}
	if reminders {
		b = fmt.Appendf(b, "|reminders")
	}
	if repeat != nil {
		b = fmt.Appendf(b, "|repeat=%q", repeat.EndDate)
	}
	if replaces != "" {
		b = fmt.Appendf(b, "|replaces=%q", replaces)
	}
	if storeID != "" {
		b = fmt.Appendf(b, "|store=%q", storeID)
	}
	for _, l := range lines { // and for lines: "7.5" and "7.50" are the same line
		b = fmt.Appendf(b, "|%q|%s|%s", l.description, l.quantity.RatString(), l.price.RatString())
	}
	h := sha256.Sum256(b)
	return h[:]
}

// buildTerms computes the receive address and refuses terms that settle() would refuse, so no payer is ever shown an
// address whose money could only be refunded (docs/backend/money-safety.md).
func buildTerms(id [32]byte, chainID uint64, token, recipient string, amount *big.Int, expiresAt, settleDeadline time.Time) (address.Terms, string, error) {
	t := address.Terms{
		InvoiceID:       id,
		Recipient:       hex20(recipient),
		Token:           hex20(token),
		Amount:          amount,
		ExpiresAt:       uint64(expiresAt.Unix()),
		SettleDeadline:  uint64(settleDeadline.Unix()),
		IntendedChainID: chainID,
	}
	receiver, err := address.Receive(t)
	if err != nil {
		return t, "", fmt.Errorf("%w: %w", ErrInvalid, err)
	}
	for _, a := range [][20]byte{{}, receiver, address.Factory, address.Implementation, t.Token} {
		if t.Recipient == a {
			return t, "", fmt.Errorf("%w: the profile wallet can't receive these terms", ErrInvalid)
		}
	}
	return t, hexAddress(receiver), nil
}

func hex20(s string) [20]byte {
	var a [20]byte
	_, _ = hex.Decode(a[:], []byte(strings.TrimPrefix(s, "0x")))
	return a
}

func hexAddress(a [20]byte) string {
	return "0x" + hex.EncodeToString(a[:])
}
