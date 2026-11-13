package invoice

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

// Cross-chain payments through NEAR Intents (D-123, D-125).
const (
	// crossChainLeast: no quote for a checkout closing sooner, so the conversion lands before the close.
	crossChainLeast = 20 * time.Minute
	// A quote's deadline is the earlier of crossChainDeadline from now and crossChainBeforeClose before the close; its
	// price shows for crossChainShown, ending at least 5 minutes before that deadline.
	crossChainDeadline    = time.Hour
	crossChainBeforeClose = 10 * time.Minute
	crossChainShown       = intents.PriceWindow
	// A slow chain's deposit can take an hour to mine (intents.SlowChains): its deadline is crossChainSlowDeadline,
	// bounded by the close the same way, and a token is offered only while that leaves crossChainSlowLeast.
	crossChainSlowDeadline = 2 * time.Hour
	crossChainSlowLeast    = 90 * time.Minute
	// An open quote is given again while at least crossChainReuse of its price window is left.
	crossChainReuse = 5 * time.Minute
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
	// ErrNoLiquidity: 1Click has no liquidity for the token now (R-245); another token may convert.
	ErrNoLiquidity = errors.New("1Click has no liquidity for this token now")
	// ErrQuoteRefused: 1Click refused a quote for a reason that names neither a minimum, liquidity nor the refund address.
	ErrQuoteRefused = errors.New("NEAR Intents refused this quote")
)

// CrossToken is a token a payer can pay with through 1Click; Estimate is about what they send, in its base units, at
// 1Click's listed price with its slippage on top, as a quote asks (R-244). The quote is the real amount.
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
	AmountOutUSD   string
	RefundFee      string
	TimeEstimate   int64
	RefundTo       string
	ShownUntil     time.Time
	Deadline       time.Time
	CreatedAt      time.Time
	Signed         []byte // 1Click's answer byte for byte, so the pay page can check it (D-124)
}

// SetCrossChain lets payers pay through 1Click; nil turns cross-chain off.
func (s *Service) SetCrossChain(c *intents.Client) { s.crossChain, s.crossChainOff = c, c == nil }

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
	case !inv.CrossChainOn:
		return crossTarget{}, fmt.Errorf("%w: the payee turned it off", ErrCrossChainOff)
	case i < 0:
		return crossTarget{}, fmt.Errorf("%w: no Base USDC option", ErrCrossChainOff)
	case inv.Closed || (inv.PaymentStatus != ledger.Open && inv.PaymentStatus != ledger.PartiallyPaid):
		return crossTarget{}, fmt.Errorf("%w: not open", ErrCrossChainOff)
	case inv.OptionLocked && inv.OptionID != inv.Options[i].ID:
		return crossTarget{}, ErrPickLocked
	case inv.Confirming: // a payment still confirming isn't booked yet, so what is due can't be known
		return crossTarget{}, fmt.Errorf("%w: a payment is confirming", ErrCrossChainOff)
	case inv.Options[i].ClosesAt.Sub(now) < crossChainLeast:
		return crossTarget{}, fmt.Errorf("%w: closes in under %s", ErrCrossChainOff, crossChainLeast)
	}
	option := inv.Options[i]
	var converting bool
	if err := s.pool.QueryRow(ctx, "SELECT "+ConvertingSQL, inv.ID).Scan(&converting); err != nil {
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

// CrossChainTokens lists what the payer can pay with through 1Click (R-232): no memo chain, unpriced token, token the
// invoice takes directly or token without liquidity (R-245). due is what is still due, in the Base option's base units.
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
		if !t.NoLiquidity && offered(t, target, s.currentTime()) {
			tokens = append(tokens, CrossToken{Token: t, Estimate: estimate(target.due, target.option.Decimals, t)})
		}
	}
	return target.due, target.option.Decimals, tokens, nil
}

func offered(t intents.Token, target crossTarget, now time.Time) bool {
	if _, fits := crossDeadline(t, target.option.ClosesAt, now); intents.MemoChains[t.Blockchain] || intents.LeftOutChains[t.Blockchain] || t.USD == "" || !fits {
		return false
	}
	return !slices.ContainsFunc(target.invoice.Options, func(o Option) bool {
		return intents.Chains[o.ChainID] == t.Blockchain && o.Token == t.Contract
	}) && t.AssetID != intents.BaseUSDCAsset
}

// estimate is due (USD stablecoin base units at 1 USD, D-75) in t's base units at its listed price, with 1Click's
// slippage on top, rounded up.
func estimate(due *big.Int, decimals int, t intents.Token) *big.Int {
	price, ok := new(big.Rat).SetString(t.USD)
	if !ok || price.Sign() <= 0 {
		return nil
	}
	r := new(big.Rat).SetFrac(new(big.Int).Mul(due, pow10(t.Decimals)), pow10(decimals))
	r.Quo(r, price)
	r.Mul(r, big.NewRat(10_000+intents.Slippage, 10_000))
	q, m := new(big.Int).QuoRem(r.Num(), r.Denom(), new(big.Int))
	if m.Sign() > 0 {
		q.Add(q, big.NewInt(1))
	}
	return q
}

// crossDeadline is the deadline a quote for t asks for: the earlier of its chain's wait and crossChainBeforeClose
// before the close. fits is false when a slow chain's would leave its deposit too little time.
func crossDeadline(t intents.Token, closes, now time.Time) (deadline time.Time, fits bool) {
	wait, least := crossChainDeadline, time.Duration(0)
	if intents.SlowChains[t.Blockchain] {
		wait, least = crossChainSlowDeadline, crossChainSlowLeast
	}
	deadline = earlier(now.Add(wait), closes.Add(-crossChainBeforeClose)).Truncate(time.Second)
	return deadline, deadline.Sub(now) >= least
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
// quote is kept, given again while its window lasts (R-233), and keeps the Base option as the payer's pick, except
// from the owner's preview (R-125). allow spends from the budget all invoices share, only when 1Click is called; a
// wait over 0 refuses with *TooSoonError.
func (s *Service) QuoteCrossChain(ctx context.Context, payToken, origin, refundTo string, dry, preview bool,
	allow func() time.Duration) (CrossQuote, error) {
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
	if i < 0 || !offered(list[i], target, now) {
		return CrossQuote{}, fmt.Errorf("%w: originAsset: not a token this invoice can be paid with from another chain", ErrInvalid)
	}
	token := list[i]
	if !dry && !refundAddress.MatchString(refundTo) {
		return CrossQuote{}, fmt.Errorf("%w: refundTo: an address on the token's chain", ErrInvalid)
	}
	deadline, _ := crossDeadline(token, target.option.ClosesAt, now)
	ask := intents.Ask{Origin: origin, Amount: target.due, Recipient: target.option.ReceiveAddress, RefundTo: refundTo,
		Deadline: deadline}
	if dry {
		return s.dryQuote(ctx, ask, token, now, allow)
	}
	// ponytail: the reuse and the limits read, then insert, without a lock, so two requests at the same moment can make
	// one quote more, also for two refund addresses; the per-invoice request limit keeps that small.
	q, err := s.openQuote(ctx, target, token, refundTo, now)
	if err != nil {
		return CrossQuote{}, err
	}
	if q.ID != "" {
		return q, s.pickBase(ctx, payToken, target, preview)
	}
	if wait := allow(); wait > 0 {
		return CrossQuote{}, &TooSoonError{Wait: wait}
	}
	quote, err := s.crossChain.Quote(ctx, ask, false)
	if err != nil {
		s.learnMinimum(ctx, origin, err, now)
		return CrossQuote{}, providerError(err, target.invoice.ID, false)
	}
	q = crossQuote(quote, token, refundTo)
	q.ShownUntil = earlier(now.Add(crossChainShown), deadline.Add(-5*time.Minute))
	if err := s.pool.QueryRow(ctx, `INSERT INTO crosschain_quotes (invoice_id, option_id, origin_asset, refund_to,
		    deposit_address, amount_in, min_amount_in, amount_out, time_estimate, shown_until, deadline, signed, created_at,
		    origin_blockchain, origin_symbol, origin_decimals, address_deadline)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`, target.invoice.ID,
		target.option.ID, origin, refundTo, q.DepositAddress, q.AmountIn.String(), q.MinAmountIn.String(),
		q.AmountOut.String(), q.TimeEstimate, q.ShownUntil, q.Deadline, string(q.Signed), now, token.Blockchain,
		token.Symbol, token.Decimals, quote.AddressDeadline).Scan(&q.ID); err != nil {
		return CrossQuote{}, fmt.Errorf("save cross-chain quote for %s: %w", target.invoice.ID, err)
	}
	q.CreatedAt = now
	return q, s.pickBase(ctx, payToken, target, preview)
}

// pickBase keeps the Base option as the payer's pick, once a quote to it is given, kept or new. It shows only what the
// payer chose; the deposit on Base still chooses the option (R-56).
func (s *Service) pickBase(ctx context.Context, payToken string, target crossTarget, preview bool) error {
	if preview || target.invoice.OptionCount < 2 || target.invoice.PickedOptionID == target.option.ID {
		return nil
	}
	if err := s.PickOption(ctx, payToken, target.option.ID); err != nil && !errors.Is(err, ErrPickLocked) {
		return err
	}
	return nil
}

// openQuote is the payer's quote for the same token, refund address and amount while enough of its window is left,
// or none (an empty ID). It refuses the next quote once the invoice had CrossChainPerHour in an hour.
func (s *Service) openQuote(ctx context.Context, target crossTarget, token intents.Token, refundTo string, now time.Time) (CrossQuote, error) {
	origin := token.AssetID
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
		crossChainReuse).Scan(&q.ID, &signed, &shown, &deadline, &created, &recent); err != nil {
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
		Recipient: target.option.ReceiveAddress, RefundTo: refundTo, Deadline: *deadline}, false, s.crossChain.Signer, now)
	if err != nil {
		return CrossQuote{}, providerError(err, target.invoice.ID, false)
	}
	id := q.ID
	q = crossQuote(quote, token, refundTo)
	q.ID, q.ShownUntil, q.CreatedAt = id, shown.UTC(), created.UTC()
	return q, nil
}

func crossQuote(quote intents.Quote, token intents.Token, refundTo string) CrossQuote {
	return CrossQuote{Token: token, DepositAddress: quote.DepositAddress, AmountIn: quote.AmountIn,
		MinAmountIn: quote.MinAmountIn, AmountOut: quote.AmountOut, AmountInUSD: quote.AmountInUSD,
		AmountOutUSD: quote.AmountOutUSD, RefundFee: quote.RefundFee, TimeEstimate: quote.TimeEstimate, RefundTo: refundTo, Deadline: quote.Deadline,
		Signed: quote.Signed}
}

// learnMinimum keeps what 1Click just said of a route, so the picker shows it to the next payer at once: a minimum
// it named (D-126), or that it has no route now (R-245).
func (s *Service) learnMinimum(ctx context.Context, origin string, err error, now time.Time) {
	// A payer's price or quote refused for want of a route hides the token at once, not at the worker's next check.
	if errors.Is(err, intents.ErrNoLiquidity) {
		if err := intents.SetNoLiquidity(ctx, s.pool, origin, now); err != nil {
			slog.Warn("keep 1Click's no liquidity", "err", err)
		}
		return
	}
	var below *intents.BelowMinimum
	if !errors.As(err, &below) {
		return
	}
	minimum, _ := new(big.Int).SetString(below.Minimum, 10)
	if err := intents.SetMinimum(ctx, s.pool, origin, minimum, now); err != nil {
		slog.Warn("keep a 1Click minimum", "err", err)
	}
}

// providerError maps 1Click's answer to the payer's: a route's minimum (an *intents.BelowMinimum) or a refusal is the
// request's, the rest is 1Click's. A quote that fails its checks is logged: 1Click, or something between, changed it.
func providerError(err error, invoiceID string, dry bool) error {
	var below *intents.BelowMinimum
	switch {
	case errors.As(err, &below):
		return err
	case errors.Is(err, intents.ErrNoLiquidity): // the token's, never the refund address's
		return ErrNoLiquidity
	case errors.Is(err, intents.ErrRefused):
		// 1Click's refusals are free text: its words show in the log when it rewords one the patterns read.
		slog.Warn("1Click refused a quote", "invoice", invoiceID, "dry", dry, "err", err)
		switch {
		case dry:
			return fmt.Errorf("%w: originAsset: 1Click can't convert this token now", ErrInvalid)
		case strings.Contains(err.Error(), "refundTo"):
			return fmt.Errorf("%w: refundTo: 1Click refused the quote; check this is your address on the token's chain", ErrInvalid)
		}
		return ErrQuoteRefused
	case errors.Is(err, intents.ErrSignature) || errors.Is(err, intents.ErrMismatch):
		slog.Error("ALERT cross-chain quote failed its checks", "invoice", invoiceID, "err", err)
	default:
		slog.Warn("cross-chain quote failed", "invoice", invoiceID, "err", err)
	}
	return fmt.Errorf("%w: %v", ErrProvider, err)
}

// dryQuotes keeps dry quotes a short while: a payer's picks would otherwise call 1Click on every change.
type dryQuotes struct {
	mu    sync.Mutex
	kept  map[string]CrossQuote
	until map[string]time.Time
}

func (s *Service) dryQuote(ctx context.Context, ask intents.Ask, token intents.Token, now time.Time,
	allow func() time.Duration) (CrossQuote, error) {
	key := ask.Origin + "|" + ask.Recipient + "|" + ask.Amount.String()
	s.dry.mu.Lock()
	if q, ok := s.dry.kept[key]; ok && now.Before(s.dry.until[key]) {
		s.dry.mu.Unlock()
		return q, nil
	}
	s.dry.mu.Unlock()
	if wait := allow(); wait > 0 {
		return CrossQuote{}, &TooSoonError{Wait: wait}
	}
	quote, err := s.crossChain.Quote(ctx, ask, true)
	if err != nil {
		s.learnMinimum(ctx, ask.Origin, err, now)
		return CrossQuote{}, providerError(err, "", true)
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
