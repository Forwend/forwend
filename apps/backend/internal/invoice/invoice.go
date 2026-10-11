// Package invoice creates invoices with a locally computed receive address (R-19) and reads them back.
package invoice

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/mail"
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
	MaxTitle         = 200
	MaxNote          = 2000
	MaxClientName    = 200
	MaxClientEmail   = 254 // the longest address SMTP carries (RFC 5321)
	MaxClientAddress = 500
	MaxSenderName    = 100
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
	uint256Max = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
)

// Request is a create request after parsing; nil ExpiresInSeconds means the default.
type Request struct {
	ChainID          uint64
	Token            string
	Amount           string
	ExpiresInSeconds *int64
	Details
}

// Details are what the invoice says besides its terms; "" means none. Like the terms, they never change.
type Details struct {
	Title         string
	Note          string
	DueDate       string // YYYY-MM-DD; only shown: payment still closes at ExpiresAt
	ClientName    string
	ClientEmail   string
	ClientAddress string
	SenderName    string // the name the payer sees when the invoice has no issuer, such as a personal request (D-52)
}

// Invoice is the stored invoice: its terms (InvoiceTerms in the contract), number, details and statuses.
type Invoice struct {
	Details
	// A copy taken at creation; later billing changes don't reach it.
	Issuer           *profile.Issuer
	ID               string
	Number           int64 // per profile, from 1; shown as INV-0001
	chain.Asset            // Symbol and Decimals set by Get
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
}

// normalize checks the request values that need no database and returns them in canonical form.
func (r Request) normalize() (token string, amount *big.Int, expiresIn time.Duration, err error) {
	if r.ChainID == 0 || r.ChainID > math.MaxInt64 { // stored as bigint
		return "", nil, 0, fmt.Errorf("%w: chainId must be from 1 to 2^63-1", ErrInvalid)
	}
	if !evmAddress.MatchString(r.Token) {
		return "", nil, 0, fmt.Errorf("%w: token must be a 0x-prefixed 20-byte hex address", ErrInvalid)
	}
	// Length and digits first: parsing a huge string costs CPU. 2^256-1 has 78 digits.
	if len(r.Amount) > 78 || !digits.MatchString(r.Amount) {
		return "", nil, 0, fmt.Errorf("%w: amount must be a decimal string from 1 to 2^256-1", ErrInvalid)
	}
	amount, _ = new(big.Int).SetString(r.Amount, 10)
	if amount.Sign() == 0 || amount.Cmp(uint256Max) > 0 {
		return "", nil, 0, fmt.Errorf("%w: amount must be a decimal string from 1 to 2^256-1", ErrInvalid)
	}
	expiresIn = DefaultExpiresIn
	if r.ExpiresInSeconds != nil {
		// Checked in seconds first, so a huge value can't overflow the Duration.
		if s := *r.ExpiresInSeconds; s < int64(MinExpiresIn/time.Second) || s > int64(MaxExpiresIn/time.Second) {
			return "", nil, 0, fmt.Errorf("%w: expiresIn must be seconds from 900 to 31536000", ErrInvalid)
		}
		expiresIn = time.Duration(*r.ExpiresInSeconds) * time.Second
	}
	if err := r.Details.check(); err != nil {
		return "", nil, 0, err
	}
	return strings.ToLower(r.Token), amount, expiresIn, nil
}

func (d Details) check() error {
	for _, f := range []struct {
		name, value string
		max         int
		lines       bool
	}{
		{"title", d.Title, MaxTitle, false}, {"note", d.Note, MaxNote, true},
		{"client.name", d.ClientName, MaxClientName, false}, {"client.email", d.ClientEmail, MaxClientEmail, false},
		{"client.address", d.ClientAddress, MaxClientAddress, true}, {"senderName", d.SenderName, MaxSenderName, false},
	} {
		// Postgres text can't hold a NUL byte.
		if !utf8.ValidString(f.value) || utf8.RuneCountInString(f.value) > f.max || !profile.PlainText(f.value, f.lines) {
			return fmt.Errorf("%w: %s must be at most %d characters of plain text", ErrInvalid, f.name, f.max)
		}
	}
	if profile.Impersonates(d.SenderName) {
		return fmt.Errorf("%w: senderName can't name Forwend", ErrInvalid)
	}
	if d.ClientEmail != "" {
		if a, err := mail.ParseAddress(d.ClientEmail); err != nil || a.Address != d.ClientEmail {
			return fmt.Errorf("%w: client.email must be an email address like name@example.com", ErrInvalid)
		}
	}
	if d.DueDate != "" {
		// Postgres has no year 0.
		if day, err := time.Parse(time.DateOnly, d.DueDate); err != nil || day.Year() < 1 {
			return fmt.Errorf("%w: dueDate must be a date like 2026-11-01", ErrInvalid)
		}
	}
	return nil
}

// requestHash fingerprints the canonical request, so the same values sent again match and the body is never stored.
// %q keeps the texts apart whatever they contain.
func requestHash(chainID uint64, token string, amount *big.Int, expiresIn time.Duration, d Details) []byte {
	h := sha256.Sum256(fmt.Appendf(nil, "%d|%s|%s|%d|%q|%q|%q|%q|%q|%q|%q", chainID, token, amount,
		int64(expiresIn/time.Second), d.Title, d.Note, d.DueDate, d.ClientName, d.ClientEmail, d.ClientAddress,
		d.SenderName))
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
