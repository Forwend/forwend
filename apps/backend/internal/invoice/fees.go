package invoice

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/profile"

	"github.com/jackc/pgx/v5"
)

// FeePlan sets the platform fee (D-122): RateBps of the price, at least MinUSD and at most CapUSD (nil: no cap), on new
// invoices only. At launch the rate is 0, so there is no platform fee at all.
type FeePlan struct {
	RateBps        int64
	MinUSD, CapUSD *big.Rat
}

// Quoter prices one receiver deploy and settle on a chain in USD (settlement.Quotes).
type Quoter interface {
	NetworkFee(ctx context.Context, chainID uint64) (*big.Rat, error)
}

// ErrFeeQuote: a chain's network fee can't be priced now, so no invoice is made; the same request may try again.
var ErrFeeQuote = errors.New("the network fee can't be priced right now")

// quoteWait bounds a quote, which runs under the profile's lock; a slow RPC falls back on the chain's last quote.
const quoteWait = 3 * time.Second

// Pricing is how new invoices are given their fees: Quotes prices the network fee, Plan the platform fee. Without
// Quotes they carry none.
type Pricing struct {
	Quotes Quoter
	Plan   FeePlan
}

func (s *Service) SetPricing(p Pricing) {
	s.quotes, s.plan = p.Quotes, p.Plan
}

// optionFees are the network and platform fee in base units of an option whose price is price base units of a token
// with decimals, worth 1 USD (D-75). The platform fee is a rate on the price, rounded up to a base unit (R-227).
func (s *Service) optionFees(ctx context.Context, chainID uint64, decimals int, price *big.Int) (network, platform *big.Int,
	err error) {
	network, platform = new(big.Int), new(big.Int)
	if s.quotes == nil {
		return network, platform, nil
	}
	ctx, cancel := context.WithTimeout(ctx, quoteWait)
	defer cancel()
	usd, err := s.quotes.NetworkFee(ctx, chainID)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %w", ErrFeeQuote, err)
	}
	if network = usdUnits(usd, decimals); network == nil {
		return nil, nil, fmt.Errorf("%w: chain %d's fee doesn't fit the token's %d decimals", ErrFeeQuote, chainID, decimals)
	}
	if p := s.plan; p.RateBps > 0 {
		platform.Mul(price, big.NewInt(p.RateBps))
		platform.Add(platform, big.NewInt(9_999)).Quo(platform, big.NewInt(10_000))
		if p.MinUSD != nil {
			if least := usdUnits(p.MinUSD, decimals); least != nil && platform.Cmp(least) < 0 {
				platform.Set(least)
			}
		}
		if p.CapUSD != nil {
			if most := usdUnits(p.CapUSD, decimals); most != nil && platform.Cmp(most) > 0 {
				platform.Set(most)
			}
		}
	}
	return network, platform, nil
}

// OptionQuote is the fees one accepted option of a price would carry (R-227), in its base units.
type OptionQuote struct {
	ChainID                 uint64
	Token                   string
	Decimals                int
	Price                   *big.Int
	NetworkFee, PlatformFee *big.Int
}

// QuoteFees prices the fees of each option a new invoice of r's price would accept in the profile's mode, before it is
// made, and gives who pays them by default. The invoice gets its own quote when it is made.
func (s *Service) QuoteFees(ctx context.Context, profileID string, r Request) (string, []OptionQuote, error) {
	token, amount, usd, _, _, err := r.normalize()
	if err != nil {
		return "", nil, err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return "", nil, fmt.Errorf("quote fees: %w", err)
	}
	defer tx.Rollback(ctx)
	var paidBy string
	var live bool
	if err := tx.QueryRow(ctx, "SELECT fees_paid_by, livemode FROM profiles WHERE id = $1", profileID).
		Scan(&paidBy, &live); err != nil {
		return "", nil, fmt.Errorf("read profile fees: %w", err)
	}
	options, err := s.accepted(ctx, tx, r.ChainID, token, amount, usd)
	if err != nil {
		return "", nil, err
	}
	// The profile's own switches, as a create keeps them (R-136); a store's may turn off more.
	off, err := profile.TokensOff(ctx, tx, profileID, "")
	if err != nil {
		return "", nil, err
	}
	quotes := []OptionQuote{}
	for _, o := range options {
		if o.live != live || slices.Contains(off, profile.TokenPair{ChainID: o.chainID, Token: o.token}) {
			continue
		}
		q := OptionQuote{ChainID: o.chainID, Token: o.token, Decimals: o.decimals, Price: o.amount}
		if q.NetworkFee, q.PlatformFee, err = s.optionFees(ctx, o.chainID, o.decimals, o.amount); err != nil {
			return "", nil, err
		}
		quotes = append(quotes, q)
	}
	return paidBy, quotes, nil
}
