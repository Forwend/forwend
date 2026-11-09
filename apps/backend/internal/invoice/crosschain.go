package invoice

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"regexp"
	"slices"
	"sync"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

// Cross-chain payments through NEAR Intents (D-123, D-125).
const (
	// CrossChainLeast: no quote for a checkout closing sooner, so the conversion lands before the close.
	CrossChainLeast = 20 * time.Minute
	// A quote's deadline is the earlier of CrossChainDeadline from now and CrossChainBeforeClose before the close; its
	// price shows for CrossChainShown, ending at least 5 minutes before that deadline.
	CrossChainDeadline    = time.Hour
	CrossChainBeforeClose = 10 * time.Minute
	CrossChainShown       = 15 * time.Minute
	// An open quote is given again while at least CrossChainReuse of its price window is left.
	CrossChainReuse = 5 * time.Minute
	// CrossChainPerHour bounds one invoice's quotes, as each one is a 1Click call and a deposit address.
	CrossChainPerHour = 20
	dryQuoteTTL       = 30 * time.Second
)

var (
	// ErrCrossChainOff: this invoice can't be paid from another chain now; the error says why.
	ErrCrossChainOff = errors.New("cross-chain payment unavailable")
	// ErrTooManyQuotes: the invoice had CrossChainPerHour quotes in the last hour.
	ErrTooManyQuotes = errors.New("too many cross-chain quotes")
	// ErrProvider: 1Click didn't give a quote that checks out (D-124); the same request may try again.
	ErrProvider = errors.New("cross-chain provider unavailable")
)

// BelowMinimum: the chosen route delivers at least Minimum, in the Base option's base units, above the amount due.
type BelowMinimum struct{ Minimum string }

func (e *BelowMinimum) Error() string { return "below the route's minimum of " + e.Minimum }

// CrossToken is a token a payer can pay with through 1Click; Estimate is about what they send, in its base units, at
// 1Click's listed price. The quote is the real amount.
type CrossToken struct {
	intents.Token
	Estimate *big.Int
}

// CrossQuote is a quote a payer asked for. A dry one has no ID, address, window or signature.
type CrossQuote struct {
	ID             string
	Token          intents.Token
	DepositAddress string
	AmountIn       *big.Int
	MinAmountIn    *big.Int
	AmountOut      *big.Int
	AmountInUSD    string
	RefundFee      string
	TimeEstimate   int64
	RefundTo       string
	ShownUntil     time.Time
	Deadline       time.Time
	CreatedAt      time.Time
	Signed         []byte // 1Click's answer byte for byte, so the pay page can check it (D-124)
}

// SetCrossChain lets payers pay through 1Click; nil leaves cross-chain off.
func (s *Service) SetCrossChain(c *intents.Client) { s.crossChain = c }

// crossTarget is what a payer pays into from another chain: the invoice's open Base USDC option, the amount still due
// on it and its close.
type crossTarget struct {
	invoice Invoice
	option  Option
	due     *big.Int
}

func (s *Service) crossTarget(ctx context.Context, payToken string, now time.Time) (crossTarget, error) {
	if s.crossChain == nil {
		return crossTarget{}, fmt.Errorf("%w: not set up", ErrCrossChainOff)
	}
	inv, err := s.Get(ctx, payToken)
	if err != nil {
		return crossTarget{}, err
	}
	i := slices.IndexFunc(inv.Options, func(o Option) bool {
		return o.ChainID == intents.BaseChainID && o.Token == intents.BaseUSDC
	})
	switch {
	case !inv.Livemode: // 1Click has no testnet (D-123)
		return crossTarget{}, fmt.Errorf("%w: test mode", ErrCrossChainOff)
	case i < 0:
		return crossTarget{}, fmt.Errorf("%w: no Base USDC option", ErrCrossChainOff)
	case inv.Closed || (inv.PaymentStatus != ledger.Open && inv.PaymentStatus != ledger.PartiallyPaid):
		return crossTarget{}, fmt.Errorf("%w: not open", ErrCrossChainOff)
	case inv.OptionLocked && inv.OptionID != inv.Options[i].ID:
		return crossTarget{}, ErrPickLocked
	case inv.Confirming: // a payment still confirming isn't booked yet, so what is due can't be known
		return crossTarget{}, fmt.Errorf("%w: a payment is confirming", ErrCrossChainOff)
	case inv.Options[i].ClosesAt.Sub(now) < CrossChainLeast:
		return crossTarget{}, fmt.Errorf("%w: closes in under %s", ErrCrossChainOff, CrossChainLeast)
	}
	option := inv.Options[i]
	var converting bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM crosschain_quotes WHERE invoice_id = $1
		AND status IN ('KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'))`, inv.ID).Scan(&converting); err != nil {
		return crossTarget{}, fmt.Errorf("read invoice %s quotes: %w", inv.ID, err)
	}
	if converting { // a deposit 1Click saw pays the invoice: another would pay it twice
		return crossTarget{}, ErrPickLocked
	}
	amounts, err := ledger.ReadAmounts(ctx, s.pool, option.ID)
	if err != nil {
		return crossTarget{}, fmt.Errorf("read invoice %s amounts: %w", option.ID, err)
	}
	due := new(big.Int).Sub(option.Amount, amounts.Payable)
	if due.Sign() <= 0 {
		return crossTarget{}, fmt.Errorf("%w: nothing due", ErrCrossChainOff)
	}
	return crossTarget{invoice: inv, option: option, due: due}, nil
}

// CrossChainTokens lists what the payer can pay with through 1Click (R-232): no memo chain, unpriced token or token
// the invoice takes directly. due is what is still due, in the Base option's base units.
func (s *Service) CrossChainTokens(ctx context.Context, payToken string) (due *big.Int, decimals int, tokens []CrossToken, err error) {
	target, err := s.crossTarget(ctx, payToken, s.currentTime())
	if err != nil {
		return nil, 0, nil, err
	}
	list, err := intents.List(ctx, s.pool)
	if err != nil {
		return nil, 0, nil, err
	}
	for _, t := range list {
		if offered(t, target.invoice.Options) {
			tokens = append(tokens, CrossToken{Token: t, Estimate: estimate(target.due, target.option.Decimals, t)})
		}
	}
	return target.due, target.option.Decimals, tokens, nil
}

func offered(t intents.Token, direct []Option) bool {
	if intents.MemoChains[t.Blockchain] || t.USD == "" {
		return false
	}
	return !slices.ContainsFunc(direct, func(o Option) bool {
		return intents.Chains[o.ChainID] == t.Blockchain && o.Token == t.Contract
	}) && t.AssetID != intents.BaseUSDCAsset
}

// estimate is due (USD stablecoin base units at 1 USD, D-75) in t's base units at its listed price, rounded up.
func estimate(due *big.Int, decimals int, t intents.Token) *big.Int {
	price, ok := new(big.Rat).SetString(t.USD)
	if !ok || price.Sign() <= 0 {
		return nil
	}
	r := new(big.Rat).SetFrac(new(big.Int).Mul(due, pow10(t.Decimals)), pow10(decimals))
	r.Quo(r, price)
	q, m := new(big.Int).QuoRem(r.Num(), r.Denom(), new(big.Int))
	if m.Sign() > 0 {
		q.Add(q, big.NewInt(1))
	}
	return q
}

func earlier(a, b time.Time) time.Time {
	if b.Before(a) {
		return b
	}
	return a
}

func pow10(n int) *big.Int { return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil) }

// refundAddress is a plain address of any chain 1Click serves; 1Click checks it belongs to the origin's chain.
var refundAddress = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,200}$`)

// QuoteCrossChain asks 1Click for a quote that pays exactly the amount due into the Base option (R-231). A real
// quote is kept, given again while its window lasts (R-233), and keeps the Base option as the payer's pick.
func (s *Service) QuoteCrossChain(ctx context.Context, payToken, origin, refundTo string, dry bool) (CrossQuote, error) {
	now := s.currentTime()
	target, err := s.crossTarget(ctx, payToken, now)
	if err != nil {
		return CrossQuote{}, err
	}
	list, err := intents.List(ctx, s.pool)
	if err != nil {
		return CrossQuote{}, err
	}
	i := slices.IndexFunc(list, func(t intents.Token) bool { return t.AssetID == origin })
	if i < 0 || !offered(list[i], target.invoice.Options) {
		return CrossQuote{}, fmt.Errorf("%w: originAsset: not a token this invoice can be paid with from another chain", ErrInvalid)
	}
	token := list[i]
	if !dry && !refundAddress.MatchString(refundTo) {
		return CrossQuote{}, fmt.Errorf("%w: refundTo: an address on the token's chain", ErrInvalid)
	}
	deadline := earlier(now.Add(CrossChainDeadline), target.option.ClosesAt.Add(-CrossChainBeforeClose)).Truncate(time.Second)
	ask := intents.Ask{Origin: origin, Amount: target.due, Recipient: target.option.ReceiveAddress, RefundTo: refundTo,
		Deadline: deadline}
	if dry {
		return s.dryQuote(ctx, ask, token, now)
	}
	q, err := s.openQuote(ctx, target, origin, refundTo, now)
	if err != nil || q.ID != "" {
		return q, err
	}
	quote, err := s.crossChain.Quote(ctx, ask, false)
	if err != nil {
		return CrossQuote{}, providerError(err, target.invoice.ID)
	}
	q = crossQuote(quote, token, refundTo)
	q.ShownUntil = earlier(now.Add(CrossChainShown), deadline.Add(-5*time.Minute))
	if err := s.pool.QueryRow(ctx, `INSERT INTO crosschain_quotes (invoice_id, option_id, origin_asset, refund_to,
		    deposit_address, amount_in, min_amount_in, amount_out, time_estimate, shown_until, deadline, signed, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`, target.invoice.ID, target.option.ID,
		origin, refundTo, q.DepositAddress, q.AmountIn.String(), q.MinAmountIn.String(), q.AmountOut.String(),
		q.TimeEstimate, q.ShownUntil, q.Deadline, string(q.Signed), now).Scan(&q.ID); err != nil {
		return CrossQuote{}, fmt.Errorf("save cross-chain quote for %s: %w", target.invoice.ID, err)
	}
	q.CreatedAt = now
	// The pick shows only what the payer chose; the deposit on Base still chooses the option (R-56).
	if target.invoice.OptionCount > 1 && target.invoice.PickedOptionID != target.option.ID {
		if err := s.PickOption(ctx, payToken, target.option.ID); err != nil && !errors.Is(err, ErrPickLocked) {
			return CrossQuote{}, err
		}
	}
	return q, nil
}

// openQuote is the payer's quote for the same token, refund address and amount while enough of its window is left,
// or none (an empty ID). It refuses the next quote once the invoice had CrossChainPerHour in an hour.
func (s *Service) openQuote(ctx context.Context, target crossTarget, origin, refundTo string, now time.Time) (CrossQuote, error) {
	var q CrossQuote
	var signed string
	var shown, deadline, created *time.Time // none without an open quote
	var recent int
	if err := s.pool.QueryRow(ctx, `SELECT coalesce(q.id::text, ''), coalesce(q.signed, ''), q.shown_until, q.deadline,
		    q.created_at, (SELECT count(*) FROM crosschain_quotes r WHERE r.invoice_id = $1
		        AND r.created_at > $5::timestamptz - interval '1 hour')
		FROM (SELECT 1) one LEFT JOIN LATERAL (SELECT id, signed, shown_until, deadline, created_at FROM crosschain_quotes
		    WHERE invoice_id = $1 AND origin_asset = $2 AND refund_to = $3 AND amount_out = $4::numeric
		      AND status = 'PENDING_DEPOSIT' AND shown_until > $5::timestamptz + $6::interval
		    ORDER BY created_at DESC LIMIT 1) q ON true`, target.invoice.ID, origin, refundTo, target.due.String(), now,
		CrossChainReuse).Scan(&q.ID, &signed, &shown, &deadline, &created, &recent); err != nil {
		return CrossQuote{}, fmt.Errorf("read open cross-chain quote for %s: %w", target.invoice.ID, err)
	}
	if q.ID == "" {
		if recent >= CrossChainPerHour {
			return CrossQuote{}, ErrTooManyQuotes
		}
		return CrossQuote{}, nil
	}
	// The kept answer is checked again as the pay page checks it, so a changed row can't reach a payer.
	quote, err := intents.Check([]byte(signed), intents.Ask{Origin: origin, Amount: target.due,
		Recipient: target.option.ReceiveAddress, RefundTo: refundTo, Deadline: *deadline}, false, s.crossChain.Signer)
	if err != nil {
		return CrossQuote{}, providerError(err, target.invoice.ID)
	}
	list, err := intents.List(ctx, s.pool)
	if err != nil {
		return CrossQuote{}, err
	}
	var token intents.Token
	if i := slices.IndexFunc(list, func(t intents.Token) bool { return t.AssetID == origin }); i >= 0 {
		token = list[i]
	}
	id := q.ID
	q = crossQuote(quote, token, refundTo)
	q.ID, q.ShownUntil, q.CreatedAt = id, shown.UTC(), created.UTC()
	return q, nil
}

func crossQuote(quote intents.Quote, token intents.Token, refundTo string) CrossQuote {
	return CrossQuote{Token: token, DepositAddress: quote.DepositAddress, AmountIn: quote.AmountIn,
		MinAmountIn: quote.MinAmountIn, AmountOut: quote.AmountOut, AmountInUSD: quote.AmountInUSD,
		RefundFee: quote.RefundFee, TimeEstimate: quote.TimeEstimate, RefundTo: refundTo, Deadline: quote.Deadline,
		Signed: quote.Signed}
}

// providerError maps 1Click's answer to the payer's: a too-small amount or refused address is the request's, the
// rest is 1Click's. A quote that fails its checks is logged: it means 1Click, or something between, changed it.
func providerError(err error, invoiceID string) error {
	var below *intents.BelowMinimum
	switch {
	case errors.As(err, &below):
		return &BelowMinimum{Minimum: below.Minimum}
	case errors.Is(err, intents.ErrRefused):
		return fmt.Errorf("%w: refundTo: 1Click can't refund to this address on the token's chain", ErrInvalid)
	case errors.Is(err, intents.ErrSignature) || errors.Is(err, intents.ErrMismatch):
		slog.Error("ALERT cross-chain quote failed its checks", "invoice", invoiceID, "err", err)
	}
	return fmt.Errorf("%w: %v", ErrProvider, err)
}

// dryQuotes keeps dry quotes a short while: a payer's picks would otherwise call 1Click on every change.
type dryQuotes struct {
	mu    sync.Mutex
	kept  map[string]CrossQuote
	until map[string]time.Time
}

func (s *Service) dryQuote(ctx context.Context, ask intents.Ask, token intents.Token, now time.Time) (CrossQuote, error) {
	key := ask.Origin + "|" + ask.Recipient + "|" + ask.Amount.String()
	s.dry.mu.Lock()
	if q, ok := s.dry.kept[key]; ok && now.Before(s.dry.until[key]) {
		s.dry.mu.Unlock()
		return q, nil
	}
	s.dry.mu.Unlock()
	quote, err := s.crossChain.Quote(ctx, ask, true)
	if err != nil {
		return CrossQuote{}, providerError(err, "")
	}
	q := crossQuote(quote, token, "")
	q.Signed, q.Deadline = nil, time.Time{}
	s.dry.mu.Lock()
	defer s.dry.mu.Unlock()
	if s.dry.kept == nil {
		s.dry.kept, s.dry.until = map[string]CrossQuote{}, map[string]time.Time{}
	}
	for k, until := range s.dry.until { // ponytail: a full sweep per miss; fine for the few quotes a replica holds
		if !now.Before(until) {
			delete(s.dry.kept, k)
			delete(s.dry.until, k)
		}
	}
	s.dry.kept[key], s.dry.until[key] = q, now.Add(dryQuoteTTL)
	return q, nil
}
