package settlement

import (
	"context"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

func TestCeilCentsRoundsUpToACent(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"0", "1/100"}, {"1/1000000", "1/100"}, {"1/100", "1/100"}, {"101/10000", "1/50"}, {"3/2", "3/2"},
	} {
		in, _ := new(big.Rat).SetString(c.in)
		if got := CeilCents(in).String(); got != c.want {
			t.Errorf("CeilCents(%s) = %s, want %s", c.in, got, c.want)
		}
	}
}

// R-227: a deploy and a settle at the chain's fee cap, twice over, in USD rounded up to a cent: ETH/USD prices ether.
func TestNetworkFeeIsADeployAndSettleAtTheFeeCap(t *testing.T) {
	a := chaintest.Start(t)
	client, err := ethclient.Dial(a.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	ctx := context.Background()
	_, feeCap, err := Fees(ctx, client, chaintest.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	// Anvil's gas is cheap: 20,000 USD an ether makes a fee above a cent, so the margin and the price both show.
	chain.EthUSD[chaintest.ChainID] = a.PriceFeed(big.NewInt(20_000e8))
	t.Cleanup(func() { delete(chain.EthUSD, chaintest.ChainID) })
	want := new(big.Rat).SetFrac(new(big.Int).Mul(feeCap, big.NewInt(MinGas*NetworkFeeMargin*20_000)), big.NewInt(1e18))
	q := NewQuotes(func(uint64) (*ethclient.Client, error) { return client, nil })
	got, err := q.NetworkFee(ctx, chaintest.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Cmp(CeilCents(want)) != 0 {
		t.Fatalf("network fee %s USD, want %s rounded up to a cent", got.FloatString(2), want.FloatString(6))
	}
	// A chain's quote serves its invoices for a while: a price change shows only after QuoteAge.
	a.PriceFeed(big.NewInt(1e8))
	if again, err := q.NetworkFee(ctx, chaintest.ChainID); err != nil || again.Cmp(got) != 0 {
		t.Fatalf("quote again: %v (%v), want the kept %s", again, err, got.FloatString(2))
	}
}
