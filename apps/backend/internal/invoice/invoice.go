// Package invoice creates invoices with a locally computed receive address (R-19) and reads them back.
package invoice

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/finality"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

// Expiry bounds and the settle window (D-18).
const (
	DefaultExpiresIn = time.Hour
	MinExpiresIn     = 15 * time.Minute
	MaxExpiresIn     = 365 * 24 * time.Hour
	SettleWindow     = 24 * time.Hour
)

// Longest details, in characters (R-42).
const (
	MaxTitle      = 200
	MaxNote       = 2000
	MaxSenderName = 100
	MaxReturnURL  = 2000
)

// MaxOpen and MaxPerDay bound a profile's watched receive addresses: each is in every scan until 30 days after its
// settle deadline.
const (
	MaxOpen   = 1000
	MaxPerDay = 500
)

var (
	// ErrInvalid wraps a request value that breaks a rule; the message names it.
	ErrInvalid = errors.New("invalid invoice request")
	// ErrConflict means the idempotency key was used with another request.
	ErrConflict = errors.New("idempotency key reused with another request")
	ErrNotFound = errors.New("invoice not found")
	// ErrNotWatched: the worker has not scanned the chain yet, and its first scan starts at the finalized block, so a
	// payment made before it would never be seen (SEC-02).
	ErrNotWatched = errors.New("network not watched yet")
)

var (
	evmAddress = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
	digits     = regexp.MustCompile(`^[0-9]+$`)
	usdAmount  = regexp.MustCompile(`^[0-9]{1,60}(\.[0-9]{1,18})?$`)
	quantity   = regexp.MustCompile(`^[0-9]{1,7}(\.[0-9]{1,2})?$`)
	uint256Max = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
)

// Request is a create request after parsing; nil ExpiresInSeconds means the default. A fixed invoice names ChainID,
// Token and Amount in base units; payer chooses (R-56) names only AmountUSD, a decimal like "12.50", and accepts every
// enabled token at 1 USD each (D-75).
type Request struct {
	ChainID          uint64
	Token            string
	Amount           string
	AmountUSD        string
	ExpiresInSeconds *int64
	Details
	// Lines break the amount down (R-88): each UnitPrice is in the amount's own unit, base units with Amount and a USD
	// decimal with AmountUSD, and the lines add up exactly to it.
	Lines []LineRequest
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

// MaxLines and MaxLineDescription bound a request's lines (R-88).
const (
	MaxLines           = 50
	MaxLineDescription = 200
)

// line is a request line after checking: its quantity and unit price as exact fractions.
type line struct {
	description string
	quantity    *big.Rat
	price       *big.Rat
}

// Details are what the invoice says besides its terms; "" means none. Like the terms, they never change.
type Details struct {
	Title         string
	Note          string
	DueDate       string // YYYY-MM-DD; only shown: payment still closes at ExpiresAt
	SupplyDate    string // YYYY-MM-DD: when the work was done or delivered (R-89)
	ClientName    string
	ClientEmail   string
	ClientAddress string
	ClientCountry string // ISO 3166-1 alpha-2
	ClientTaxID   string
	SenderName    string // the name the payer sees when the invoice has no issuer, such as a personal request (D-52)
	ReturnURL     string // an https link to the creator's site, offered to the payer once paid (R-58)
}

// Invoice is the stored invoice: its terms (InvoiceTerms in the contract), number, details and statuses. With
// several options the terms and statuses are the current option's: the chosen one, else the first.
type Invoice struct {
	Details
	Lines []Line // set by Get
	// A copy taken at creation; later billing changes don't reach it.
	Issuer       *profile.Issuer
	ID           string // the pay link's id: the main row's
	OptionID     string // the on-chain id of the terms below; ID for a fixed invoice
	OptionLocked bool   // an option received money, so the payer can't pick another
	OptionCount  int    // accepted options: 1 for a fixed invoice
	// Confirming: a payment before expiry is seen and not final yet. A partly paid invoice keeps that status while the
	// rest confirms (the database allows no way back to detected), so readers show it as confirming (R-69).
	Confirming bool
	// Closed: the checkout closed and the invoice can no longer be paid, before its status catches up (ClosedSQL).
	Closed           bool
	NextCheckAt      time.Time // when Check status may run again; zero when it may now. Set by Get
	Options          []Option  // every accepted option, the current one included; set by Get
	Number           int64     // per profile, from 1; shown as INV-0001
	chain.Asset                // Symbol and Decimals set by Get
	Amount           *big.Int
	Recipient        string
	Factory          string
	ReceiveAddress   string
	ExpiresAt        time.Time
	SettleDeadline   time.Time
	PaymentStatus    string
	SettlementStatus string
	RefundStatus     string
	SettlementTxHash string // the signer's settle transaction once settled
	CreatedAt        time.Time
	Deposits         []Deposit // set by Get
	Network          string    // the chain's name; set by Get
	// PaidAt is the block time of the deposit that completed the amount owed to the creator; set by Get once paid.
	PaidAt time.Time
	// SettledAt is when the settlement was booked as final, from the ledger; set by Get once settled.
	SettledAt time.Time
	// CanceledAt is when the owner canceled it (R-79); zero otherwise.
	CanceledAt time.Time
	// SettlementWait says why a paid invoice's money has not reached the creator yet; nil when it is not waiting.
	// Set by Get.
	SettlementWait *SettlementWait
}

// Why a paid invoice still waits to settle (R-54).
const (
	WaitSigning    = "signing"    // the signer settles it on its next round
	WaitFinalizing = "finalizing" // the settle was sent; it counts once its block is final (D-45)
	WaitRetrying   = "retrying"   // a temporary condition; the signer tries again at Until
	WaitDailyLimit = "dailyLimit" // the user's sponsored settlements for 24 hours are used up (SEC-03); next try at Until
	WaitRefused    = "refused"    // the signer refused the terms; an operator looks at it
)

// SettlementWait is one of the Wait kinds, with when the signer tries again (retrying, daily limit) or the estimated
// chain time until the sent settle is final (finalizing).
type SettlementWait struct {
	Kind     string
	Until    time.Time
	TimeLeft time.Duration
}

// Option is one accepted token and network with its own on-chain id, amount and receive address; recipient, expiry
// and settle deadline are the invoice's.
type Option struct {
	ID string
	chain.Asset
	Network        string
	Amount         *big.Int
	ReceiveAddress string
	Deposits       []Deposit // set by Get
}

// Deposit is a transfer to the receive address that is not reorged. Until its block is final, Progress says how far
// the chain's finalized block still has to go (R-28).
type Deposit struct {
	TxHash      string
	LogIndex    uint64
	From        string // sender, lowercase hex
	Amount      *big.Int
	BlockNumber uint64
	BlockTime   time.Time
	Status      string // detected or confirmed
	Late        bool   // block time after expiresAt: held for the payer (D-26)
	finality.Progress
	// BlocksTotal is the blocks it had to wait when first seen, at least BlocksLeft: the m of "Confirming (n/m)" (R-73).
	BlocksTotal uint64
}

// normalize checks the request values that need no database and returns them in canonical form: token and amount
// for a fixed invoice, usd for payer chooses.
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

// checkLines parses the lines and checks they add up exactly to total. With usd the unit prices are USD decimals,
// otherwise base units, so each line's quantity times price must then be whole base units.
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

// usdUnits is usd in a token's base units at 1 USD per token (D-75), or nil when the token's decimals can't hold it
// exactly or it passes 2^256-1.
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
		{"senderName", d.SenderName, MaxSenderName, false},
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
func requestHash(chainID uint64, token string, amount fmt.Stringer, expiresIn time.Duration, d Details, lines []line) []byte {
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
