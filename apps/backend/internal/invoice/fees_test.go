package invoice

import (
	"context"
	"errors"
	"math/big"
	"testing"
)

type chainQuotes map[uint64]*big.Rat

func (q chainQuotes) NetworkFee(_ context.Context, chainID uint64) (*big.Rat, error) {
	if usd, ok := q[chainID]; ok {
		return usd, nil
	}
	return nil, errors.New("no quote")
}

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
	o, err := (&Service{}).priced(accepted{chainID: 84532, decimals: 6, amount: big.NewInt(5_000_000)}, nil, false)
	if err != nil || o.networkFee.Sign() != 0 || o.platformFee.Sign() != 0 {
		t.Errorf("no pricing: %v %v (%v), want none", o.networkFee, o.platformFee, err)
	}
}

func TestPayerChoosesDropsANetworkWhoseFeeItsPriceCantCarry(t *testing.T) {
	s := &Service{}
	s.SetPricing(Pricing{Quotes: chainQuotes{1: big.NewRat(1, 100), 2: big.NewRat(6, 100), 3: big.NewRat(4, 10)}})
	options := func(price int64, chains ...uint64) []accepted {
		var out []accepted
		for _, id := range chains {
			out = append(out, accepted{chainID: id, decimals: 6, amount: big.NewInt(price)})
		}
		return out
	}
	got, err := s.withFees(context.Background(), options(3_000_000, 1, 2, 3), true, false)
	if err != nil || len(got) != 2 || got[0].chainID != 1 || got[1].chainID != 2 {
		t.Fatalf("options %+v (%v), want chains 1 and 2", got, err)
	}
	for _, o := range got {
		if o.networkFee.String() != "60000" || o.amount.String() != "3000000" {
			t.Errorf("chain %d: fee %s amount %s, want the highest fee 60000 on 3000000", o.chainID, o.networkFee, o.amount)
		}
	}
	if _, err := s.withFees(context.Background(), options(90_000, 1, 2), true, false); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a price no network's fee fits: %v, want ErrInvalid", err)
	}
}
