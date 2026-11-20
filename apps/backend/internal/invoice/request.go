package invoice

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

// Longest details, in characters.
const (
	MaxTitle      = 200
	MaxNote       = 2000
	MaxSenderName = 100
	MaxReturnURL  = 2000
)

var (
	evmAddress = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
	digits     = regexp.MustCompile(`^[0-9]+$`)
	usdAmount  = regexp.MustCompile(`^[0-9]{1,60}(\.[0-9]{1,18})?$`)
	quantity   = regexp.MustCompile(`^[0-9]{1,7}(\.[0-9]{1,2})?$`)
	uint256Max = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
)

// Request is fixed (Amount) or payer-chooses (AmountUSD); retainers store it as JSON, so a rename needs a migration.
type Request struct {
	ChainID          uint64
	Token            string
	Amount           string
	AmountUSD        string
	ExpiresInSeconds *int64
	Details
	Lines      []LineRequest // add up to the amount, in its unit
	Agreed     *AgreedRequest
	Reminders  bool
	Repeat     *Repeat
	Replaces   string // canceled in the same transaction
	FeesPaidBy string // "" takes the profile's
	StoreID    string // "" is the profile's first store
	Caller     Caller `json:"-"`
	cycle      *cycle
}

// Caller is who asks for an invoice and their workflow's rules; a retainer never stores it.
type Caller struct {
	Purpose  Purpose // checkout only; "" goes by the profile's kind
	LinkID   string
	By       history.Actor // "" is the owner
	Livemode *bool
	Stores   []string                                                     // nil: every store
	Before   func(ctx context.Context, tx pgx.Tx) error                   // under the profile lock, before Allow
	Allow    func() time.Duration                                         // just before the insert
	After    func(ctx context.Context, tx pgx.Tx, invoiceID string) error // in the insert's transaction; not on a replay
}

type AgreedRequest struct {
	Currency string
	Amount   string // a decimal with at most the currency's decimals, like "1000.50"
	Date     string // YYYY-MM-DD
}

// AgreedCurrencies: EUR and the ECB's daily rate currencies, ISO 4217 decimals; the web's copy is tested.
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

// MinUSDCents is the least a new payment asks: below it, a deposit can't be told apart from dust.
const MinUSDCents = 100

var minUSD = big.NewRat(MinUSDCents, 100)

func USD(cents int64) string {
	return fmt.Sprintf("%d.%02d", cents/100, cents%100)
}

const (
	MaxLines           = 100
	MaxLineDescription = 200
	MaxLineQuantity    = 1_000_000
)

type line struct {
	description string
	quantity    *big.Rat
	price       *big.Rat
}

const (
	MaxMetadataKeys  = 20
	MaxMetadataValue = 500
)

var metadataKey = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)

func (r Request) normalize() (token string, amount *big.Int, usd *big.Rat, lines []line, expiresIn time.Duration, err error) {
	if r.AmountUSD != "" {
		if r.ChainID != 0 || r.Token != "" || r.Amount != "" {
			return "", nil, nil, nil, 0, fmt.Errorf("%w: send amountUsd alone, or chainId, token and amount", ErrInvalid)
		}
		// Pattern first: parsing a huge string costs CPU.
		if usdAmount.MatchString(r.AmountUSD) {
			usd, _ = new(big.Rat).SetString(r.AmountUSD)
		}
		if usd == nil || usd.Cmp(minUSD) < 0 {
			return "", nil, nil, nil, 0, fmt.Errorf("%w: amountUsd must be a decimal like 12.50, at least 1.00", ErrInvalid)
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
	if r.FeesPaidBy != "" && r.FeesPaidBy != FeesPaidByOwner && r.FeesPaidBy != FeesPaidByClient {
		return "", nil, nil, nil, 0, fmt.Errorf("%w: feesPaidBy must be owner or client", ErrInvalid)
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
		if l.Description == "" || !profile.ValidText(l.Description, MaxLineDescription, false) {
			return nil, fmt.Errorf("%w: lines need a description of at most %d characters of plain text", ErrInvalid,
				MaxLineDescription)
		}
		// Patterns first: parsing a huge string costs CPU.
		var q, p *big.Rat
		if quantity.MatchString(l.Quantity) {
			q, _ = new(big.Rat).SetString(l.Quantity)
		}
		if q == nil || q.Sign() == 0 || q.Cmp(big.NewRat(MaxLineQuantity, 1)) > 0 {
			return nil, fmt.Errorf("%w: lines need a quantity above 0 and at most %d, with up to 2 decimals", ErrInvalid,
				MaxLineQuantity)
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

// usdUnits converts at 1 USD per token; nil when the decimals can't hold it exactly or it passes 2^256-1.
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
		if !profile.ValidText(f.value, f.max, f.lines) {
			return fmt.Errorf("%w: %s must be at most %d characters of plain text", ErrInvalid, f.name, f.max)
		}
	}
	if profile.Impersonates(d.SenderName) {
		return fmt.Errorf("%w: senderName can't name Forwend", ErrInvalid)
	}
	// A saved client's rules, so a client copied from the list fits.
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
		badMetadata = badMetadata || !metadataKey.MatchString(k) || !profile.ValidText(v, MaxMetadataValue, false)
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

// requestHash fingerprints the request for retries; a part added later joins only when set, so stored hashes match.
func requestHash(r Request, chainID uint64, token string, amount fmt.Stringer, expiresIn time.Duration,
	lines []line) []byte {
	d := r.Details
	b := fmt.Appendf(nil, "%d|%s|%s|%d|%q|%q|%q|%q|%q|%q|%q", chainID, token, amount,
		int64(expiresIn/time.Second), d.Title, d.Note, d.DueDate, d.ClientName, d.ClientEmail, d.ClientAddress,
		d.SenderName)
	if d.ReturnURL != "" {
		b = fmt.Appendf(b, "|%q", d.ReturnURL)
	}
	if d.ClientCountry != "" || d.ClientTaxID != "" {
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
	if r.Reminders {
		b = fmt.Appendf(b, "|reminders")
	}
	if r.Repeat != nil {
		b = fmt.Appendf(b, "|repeat=%q", r.Repeat.EndDate)
	}
	if r.Replaces != "" {
		b = fmt.Appendf(b, "|replaces=%q", r.Replaces)
	}
	if r.StoreID != "" {
		b = fmt.Appendf(b, "|store=%q", r.StoreID)
	}
	for _, l := range lines { // as rationals: "7.5" and "7.50" are the same line
		b = fmt.Appendf(b, "|%q|%s|%s", l.description, l.quantity.RatString(), l.price.RatString())
	}
	h := sha256.Sum256(b)
	// Purpose and who pays the fees join as a hash of the hash, so older stored hashes still match.
	if r.Caller.Purpose != "" {
		h = sha256.Sum256(append(h[:], "|purpose="+string(r.Caller.Purpose)...))
	}
	if r.FeesPaidBy != "" {
		h = sha256.Sum256(append(h[:], "|feesPaidBy="+r.FeesPaidBy...))
	}
	return h[:]
}
