package invoice

import (
	"context"
	"math/big"
	"testing"
)

type fixedQuote struct{ usd *big.Rat }

func (q fixedQuote) NetworkFee(context.Context, uint64) (*big.Rat, error) { return q.usd, nil }

// D-122: the platform fee is a rate on the price, rounded up to a base unit, within the plan's minimum and cap; at 0%
// there is none. The network fee is the quote in the token's base units.
func TestOptionFeesFollowTheQuoteAndThePlan(t *testing.T) {
	for _, c := range []struct {
		name              string
		plan              FeePlan
		price             int64
		network, platform string
	}{
		{"0% at launch, even with a minimum", FeePlan{MinUSD: big.NewRat(1, 2)}, 5_000_000, "20000", "0"},
		{"0.5% of the price", FeePlan{RateBps: 50}, 5_000_000, "20000", "25000"},
		{"a part of a base unit rounds up", FeePlan{RateBps: 50}, 1_000_001, "20000", "5001"},
		{"the minimum", FeePlan{RateBps: 50, MinUSD: big.NewRat(1, 10)}, 5_000_000, "20000", "100000"},
		{"the cap", FeePlan{RateBps: 50, CapUSD: big.NewRat(10, 1)}, 10_000_000_000, "20000", "10000000"},
	} {
		s := &Service{}
		s.SetPricing(Pricing{Quotes: fixedQuote{big.NewRat(2, 100)}, Plan: c.plan})
		network, platform, err := s.optionFees(context.Background(), 84532, 6, big.NewInt(c.price))
		if err != nil || network.String() != c.network || platform.String() != c.platform {
			t.Errorf("%s: network %v, platform %v (%v); want %s, %s", c.name, network, platform, err, c.network, c.platform)
		}
	}
	// Without pricing an invoice carries no fees, as before the fees.
	network, platform, err := (&Service{}).optionFees(context.Background(), 84532, 6, big.NewInt(5_000_000))
	if err != nil || network.Sign() != 0 || platform.Sign() != 0 {
		t.Errorf("no pricing: %v %v (%v), want none", network, platform, err)
	}
}
