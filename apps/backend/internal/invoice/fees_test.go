package invoice

import (
	"context"
	"errors"
	"math/big"
	"testing"
)

// chainQuotes quotes each chain's network fee in USD; a chain it lacks can't be priced.
type chainQuotes map[uint64]*big.Rat

func (q chainQuotes) NetworkFee(_ context.Context, chainID uint64) (*big.Rat, error) {
	if usd, ok := q[chainID]; ok {
		return usd, nil
	}
	return nil, errors.New("no quote")
}

// D-122: the platform fee is a rate on the price, rounded up to a base unit, within the plan's minimum and cap; at 0%
// there is none. The network fee is the quote in the token's base units.
func TestOptionFeesFollowTheQuoteAndThePlan(t *testing.T) {
	two := big.NewRat(2, 100)
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
		s.SetPricing(Pricing{Quotes: chainQuotes{84532: two}, Plan: c.plan})
		o, err := s.priced(accepted{chainID: 84532, decimals: 6, amount: big.NewInt(c.price)}, two, false)
		if err != nil || o.networkFee.String() != c.network || o.platformFee.String() != c.platform {
			t.Errorf("%s: network %v, platform %v (%v); want %s, %s", c.name, o.networkFee, o.platformFee, err,
				c.network, c.platform)
		}
	}
	// Without pricing an invoice carries no fees, as before the fees.
	o, err := (&Service{}).priced(accepted{chainID: 84532, decimals: 6, amount: big.NewInt(5_000_000)}, nil, false)
	if err != nil || o.networkFee.Sign() != 0 || o.platformFee.Sign() != 0 {
		t.Errorf("no pricing: %v %v (%v), want none", o.networkFee, o.platformFee, err)
	}
}

// Every option takes the highest fee its networks quote, so one amount covers any network the client picks. A
// payer-chooses invoice first drops a network it can't price, or whose own fee its price can't carry.
func TestEveryOptionTakesTheHighestNetworkFee(t *testing.T) {
	s := &Service{}
	s.SetPricing(Pricing{Quotes: chainQuotes{1: big.NewRat(1, 100), 2: big.NewRat(6, 100), 3: big.NewRat(4, 10)}})
	options := func(price int64, chains ...uint64) []accepted {
		var out []accepted
		for _, id := range chains {
			out = append(out, accepted{chainID: id, decimals: 6, amount: big.NewInt(price)})
		}
		return out
	}
	for _, c := range []struct {
		name       string
		options    []accepted
		chooses    bool
		clientPays bool
		chains     []uint64
		fee        string
		amount     string
	}{
		{"the client pays the highest on top, on every network", options(45_000_000, 1, 2), true, true,
			[]uint64{1, 2}, "60000", "45060000"},
		{"the owner has the highest deducted", options(45_000_000, 1, 2), true, false,
			[]uint64{1, 2}, "60000", "45000000"},
		{"a network that can't be priced is left out", options(45_000_000, 1, 2, 9), true, false,
			[]uint64{1, 2}, "60000", "45000000"},
		{"a network whose fee the price can't carry is left out", options(3_000_000, 1, 2, 3), true, false,
			[]uint64{1, 2}, "60000", "3000000"},
	} {
		got, err := s.withFees(context.Background(), c.options, c.chooses, c.clientPays)
		if err != nil || len(got) != len(c.chains) {
			t.Fatalf("%s: %d options (%v), want %d", c.name, len(got), err, len(c.chains))
		}
		for i, o := range got {
			if o.chainID != c.chains[i] || o.networkFee.String() != c.fee || o.amount.String() != c.amount {
				t.Errorf("%s: chain %d fee %s amount %s; want chain %d fee %s amount %s", c.name, o.chainID,
					o.networkFee, o.amount, c.chains[i], c.fee, c.amount)
			}
		}
	}
	if _, err := s.withFees(context.Background(), options(45_000_000, 9), false, false); !errors.Is(err, ErrFeeQuote) {
		t.Fatalf("a fixed invoice on a chain that can't be priced: %v, want ErrFeeQuote", err)
	}
	if _, err := s.withFees(context.Background(), options(90_000, 1, 2), true, false); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a price no network's fee fits: %v, want ErrInvalid", err)
	}
}
