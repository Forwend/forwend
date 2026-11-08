package invoice

import (
	"cmp"
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

// networkFee is what the chain quotes for its deploy and settle, in USD; nothing without Quotes.
func (s *Service) networkFee(ctx context.Context, chainID uint64) (*big.Rat, error) {
	if s.quotes == nil {
		return new(big.Rat), nil
	}
	ctx, cancel := context.WithTimeout(ctx, quoteWait)
	defer cancel()
	usd, err := s.quotes.NetworkFee(ctx, chainID)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrFeeQuote, err)
	}
	return usd, nil
}

// withFees gives each option of a new invoice its fees, on top of its amount when the client pays them (D-122). Every
// option takes the highest network fee its networks quote, so one amount pays the fee on whichever network the client
// picks. A payer-chooses invoice first leaves out a network it can't price now, or whose own fee its price can't carry,
// as it does an unscanned one; a fixed invoice has no other to offer.
func (s *Service) withFees(ctx context.Context, options []accepted, chooses, clientPays bool) ([]accepted, error) {
	var feeErr error
	var top *big.Rat
	kept := options[:0]
	for _, o := range options {
		usd, err := s.networkFee(ctx, o.chainID)
		if err == nil {
			_, err = s.priced(o, usd, clientPays)
		}
		if err != nil {
			feeErr = err
			continue
		}
		if top == nil || usd.Cmp(top) > 0 {
			top = usd
		}
		kept = append(kept, o)
	}
	if feeErr != nil && (!chooses || len(kept) == 0) {
		return nil, feeErr
	}
	for i, o := range kept {
		var err error
		if kept[i], err = s.priced(o, top, clientPays); err != nil {
			return nil, err
		}
	}
	return kept, nil
}

// priced is o with the fees of a network fee of usd, its amount raised by them when the client pays. Fees past a tenth
// of the amount are refused, as settle() refuses them. The platform fee is a rate on the price, rounded up to a base
// unit (R-227). Each token is worth 1 USD (D-75).
func (s *Service) priced(o accepted, usd *big.Rat, clientPays bool) (accepted, error) {
	network, platform := new(big.Int), new(big.Int)
	if s.quotes != nil {
		if network = usdUnits(usd, o.decimals); network == nil {
			return o, fmt.Errorf("%w: chain %d's fee doesn't fit the token's %d decimals", ErrFeeQuote, o.chainID,
				o.decimals)
		}
		if p := s.plan; p.RateBps > 0 {
			platform.Mul(o.amount, big.NewInt(p.RateBps))
			platform.Add(platform, big.NewInt(9_999)).Quo(platform, big.NewInt(10_000))
			if p.MinUSD != nil {
				if least := usdUnits(p.MinUSD, o.decimals); least != nil && platform.Cmp(least) < 0 {
					platform.Set(least)
				}
			}
			if p.CapUSD != nil {
				if most := usdUnits(p.CapUSD, o.decimals); most != nil && platform.Cmp(most) > 0 {
					platform.Set(most)
				}
			}
		}
	}
	fees := new(big.Int).Add(network, platform)
	if clientPays {
		o.amount = new(big.Int).Add(o.amount, fees)
	}
	if new(big.Int).Mul(fees, big.NewInt(10)).Cmp(o.amount) > 0 {
		return o, fmt.Errorf("%w: the amount is too small for its fees of %s base units on chain %d", ErrInvalid,
			fees, o.chainID)
	}
	o.networkFee, o.platformFee = network, platform
	return o, nil
}

// OptionQuote is the fees one accepted option of a price would carry (R-227), in its base units.
type OptionQuote struct {
	ChainID                 uint64
	Token                   string
	Decimals                int
	Price                   *big.Int
	NetworkFee, PlatformFee *big.Int
}

// QuoteFees prices the fees of each option a new invoice of r's price would accept in the profile's mode and r's store,
// before it is made, and gives who pays them by default; r.FeesPaidBy overrides it, as a create's does. The invoice
// gets its own quote when it is made.
func (s *Service) QuoteFees(ctx context.Context, profileID string, r Request) (string, []OptionQuote, error) {
	token, amount, usd, _, _, err := r.normalize()
	if err != nil {
		return "", nil, err
	}
	if r.FeesPaidBy != "" && r.FeesPaidBy != FeesPaidByOwner && r.FeesPaidBy != FeesPaidByClient {
		return "", nil, fmt.Errorf("%w: feesPaidBy must be owner or client", ErrInvalid)
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return "", nil, fmt.Errorf("quote fees: %w", err)
	}
	defer tx.Rollback(ctx)
	var kind, paidBy string
	var live bool
	if err := tx.QueryRow(ctx, "SELECT kind, fees_paid_by, livemode FROM profiles WHERE id = $1", profileID).
		Scan(&kind, &paidBy, &live); err != nil {
		return "", nil, fmt.Errorf("read profile fees: %w", err)
	}
	options, err := s.accepted(ctx, tx, r.ChainID, token, amount, usd)
	if err != nil {
		return "", nil, err
	}
	// The tokens a create keeps (R-136): the profile's, and a merchant's store's, its first store when none is named.
	// One network more or less can change the highest fee every option carries.
	var storeID string
	switch {
	case kind == profile.Merchant:
		store, err := profile.InvoiceStore(ctx, tx, profileID, r.StoreID)
		if errors.Is(err, profile.ErrStoreNotFound) {
			return "", nil, fmt.Errorf("%w: storeId is not one of the profile's stores", ErrInvalid)
		}
		if err != nil {
			return "", nil, err
		}
		storeID = store.ID
	case r.StoreID != "":
		return "", nil, fmt.Errorf("%w: storeId: only a merchant profile has stores", ErrInvalid)
	}
	off, err := profile.TokensOff(ctx, tx, profileID, storeID)
	if err != nil {
		return "", nil, err
	}
	shown := []accepted{}
	for _, o := range options {
		if o.live == live && !slices.Contains(off, profile.TokenPair{ChainID: o.chainID, Token: o.token}) {
			shown = append(shown, o)
		}
	}
	clientPays := cmp.Or(r.FeesPaidBy, paidBy) == FeesPaidByClient
	// As a create prices them, so the form shows the fees the invoice gets.
	priced, err := s.withFees(ctx, shown, usd != nil, clientPays)
	if err != nil {
		return "", nil, err
	}
	quotes := []OptionQuote{}
	for _, o := range priced {
		price := o.amount
		if clientPays {
			price = new(big.Int).Sub(o.amount, new(big.Int).Add(o.networkFee, o.platformFee))
		}
		quotes = append(quotes, OptionQuote{ChainID: o.chainID, Token: o.token, Decimals: o.decimals, Price: price,
			NetworkFee: o.networkFee, PlatformFee: o.platformFee})
	}
	return paidBy, quotes, nil
}
