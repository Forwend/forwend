// Package invoice creates invoices with a locally computed receive address (R-19) and reads them back.
package invoice

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
)

// Expiry bounds and the settle window (D-18).
const (
	DefaultExpiresIn = time.Hour
	MinExpiresIn     = 15 * time.Minute
	MaxExpiresIn     = 365 * 24 * time.Hour
	SettleWindow     = 24 * time.Hour
)

var (
	// ErrInvalid wraps a request value that breaks a rule; the message names it.
	ErrInvalid = errors.New("invalid invoice request")
	// ErrConflict means the idempotency key was used with another request.
	ErrConflict = errors.New("idempotency key reused with another request")
	ErrNotFound = errors.New("invoice not found")
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
}

// Invoice is the stored invoice: its terms (InvoiceTerms in the contract) and statuses.
type Invoice struct {
	ID               string
	ChainID          uint64
	Token            string
	Amount           *big.Int
	Recipient        string
	Factory          string
	ReceiveAddress   string
	ExpiresAt        time.Time
	SettleDeadline   time.Time
	PaymentStatus    string
	SettlementStatus string
	RefundStatus     string
	CreatedAt        time.Time
	Deposits         []Deposit // set by Get
}

// Deposit is a transfer to the receive address that is not reorged. Until its block is final, BlocksLeft and
// TimeLeft say how far the chain's finalized block still has to go (R-28).
type Deposit struct {
	TxHash      string
	LogIndex    uint64
	Amount      *big.Int
	BlockNumber uint64
	Status      string // detected or confirmed
	Late        bool   // block time after expiresAt: held for the payer (D-26)
	BlocksLeft  uint64
	TimeLeft    time.Duration
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
	return strings.ToLower(r.Token), amount, expiresIn, nil
}

// requestHash fingerprints the canonical request, so the same values sent again match and the body is never stored.
func requestHash(chainID uint64, token string, amount *big.Int, expiresIn time.Duration) []byte {
	h := sha256.Sum256(fmt.Appendf(nil, "%d|%s|%s|%d", chainID, token, amount, int64(expiresIn/time.Second)))
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
