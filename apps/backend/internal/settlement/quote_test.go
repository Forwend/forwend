package settlement

import (
	"context"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"

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

func TestNetworkFeeIsADeployAndSettleAtTheFeeCap(t *testing.T) {
	a := chaintest.Start(t)
	client, err := ethclient.Dial(a.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	ctx := context.Background()
	_, feeCap, err := chain.Fees(ctx, client, chaintest.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	// At 20 USD an ether Anvil's gas makes a fee above a cent, so the margin and the price both show.
	chain.EthUSD[chaintest.ChainID] = chain.PriceFeed{Address: a.PriceFeed(big.NewInt(20e8)), Heartbeat: time.Hour}
	t.Cleanup(func() { delete(chain.EthUSD, chaintest.ChainID) })
	want := new(big.Rat).SetFrac(new(big.Int).Mul(feeCap, big.NewInt(MinGas*NetworkFeeMargin*20)), big.NewInt(1e18))
	q := NewQuotes(func(uint64) (*ethclient.Client, error) { return client, nil })
	got, err := q.NetworkFee(ctx, chaintest.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Cmp(CeilCents(want)) != 0 {
		t.Fatalf("network fee %s USD, want %s rounded up to a cent", got.FloatString(2), want.FloatString(6))
	}
	a.PriceFeed(big.NewInt(1e8))
	if again, err := q.NetworkFee(ctx, chaintest.ChainID); err != nil || again.Cmp(got) != 0 {
		t.Fatalf("quote again: %v (%v), want the kept %s", again, err, got.FloatString(2))
	}
}

func TestNetworkFeeInDollarsTempoCapAndStaleQuote(t *testing.T) {
	a := chaintest.Start(t)
	client, err := ethclient.Dial(a.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	ctx := context.Background()
	_, feeCap, err := chain.Fees(ctx, client, chaintest.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	usd := func(gas int64) *big.Rat {
		return CeilCents(new(big.Rat).SetFrac(new(big.Int).Mul(feeCap, big.NewInt(gas*NetworkFeeMargin)), big.NewInt(1e18)))
	}
	reachable := true
	q := NewQuotes(func(uint64) (*ethclient.Client, error) {
		if !reachable {
			return nil, errors.New("rpc down")
		}
		return client, nil
	})
	if got, err := q.NetworkFee(ctx, chaintest.ChainID); err != nil || got.Cmp(usd(MinGas)) != 0 {
		t.Fatalf("Arc-like: %v (%v), want %s", got, err, usd(MinGas).FloatString(2))
	}
	if err := a.RPC.Call(nil, "anvil_setCode", chain.TempoFeeManager.Hex(), "0x00"); err != nil {
		t.Fatal(err)
	}
	if got, err := NewQuotes(q.client).NetworkFee(ctx, chaintest.ChainID); err != nil || got.Cmp(usd(TempoMinGas)) != 0 {
		t.Fatalf("Tempo-like: %v (%v), want %s", got, err, usd(TempoMinGas).FloatString(2))
	}
	reachable = false
	q.kept[chaintest.ChainID] = quote{usd: big.NewRat(3, 100), at: time.Now().Add(-QuoteAge)}
	if got, err := q.NetworkFee(ctx, chaintest.ChainID); err != nil || got.Cmp(big.NewRat(3, 100)) != 0 {
		t.Fatalf("stale quote with the RPC down: %v (%v), want the kept 0.03", got, err)
	}
	q.kept[chaintest.ChainID] = quote{usd: big.NewRat(3, 100), at: time.Now().Add(-QuoteStale)}
	if _, err := q.NetworkFee(ctx, chaintest.ChainID); err == nil {
		t.Fatal("a quote past QuoteStale served with the RPC down")
	}
	reachable = true
	chain.EthUSD[chaintest.ChainID] = chain.PriceFeed{Address: a.PriceFeed(new(big.Int).Mul(big.NewInt(1e15), big.NewInt(1e8))),
		Heartbeat: time.Hour}
	t.Cleanup(func() { delete(chain.EthUSD, chaintest.ChainID) })
	if got, err := NewQuotes(q.client).NetworkFee(ctx, chaintest.ChainID); err == nil {
		t.Fatalf("a lying feed: %v, want refused", got.FloatString(2))
	}
}

func TestAStalePriceKeepsTheLastGoodQuote(t *testing.T) {
	a := chaintest.Start(t)
	client := ethclient.NewClient(a.RPC)
	ctx := context.Background()
	chain.EthUSD[chaintest.ChainID] = chain.PriceFeed{Address: a.PriceFeed(big.NewInt(20e8)), Heartbeat: time.Hour}
	t.Cleanup(func() { delete(chain.EthUSD, chaintest.ChainID) })
	q := NewQuotes(func(uint64) (*ethclient.Client, error) { return client, nil })
	good, err := q.NetworkFee(ctx, chaintest.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	// The feed last answered two hours ago.
	a.Feed(chain.EthUSD[chaintest.ChainID].Address, big.NewInt(20e8), time.Now().Add(-3*time.Hour).Unix(),
		time.Now().Add(-2*time.Hour).Unix())
	q.kept[chaintest.ChainID] = quote{usd: good, at: time.Now().Add(-QuoteAge)}
	if got, err := q.NetworkFee(ctx, chaintest.ChainID); err != nil || got.Cmp(good) != 0 {
		t.Fatalf("a stale price with a recent quote: %v (%v), want the kept %s", got, err, good.FloatString(2))
	}
	q.kept[chaintest.ChainID] = quote{usd: good, at: time.Now().Add(-QuoteStale)}
	if _, err := q.NetworkFee(ctx, chaintest.ChainID); err == nil || !strings.Contains(err.Error(), "past its 1h0m0s heartbeat") {
		t.Fatalf("a stale price past QuoteStale: %v, want refused naming the heartbeat", err)
	}
}

func TestKeepReadsAQuoteAtStartForAnRPCThatFailsLater(t *testing.T) {
	a := chaintest.Start(t)
	client := ethclient.NewClient(a.RPC)
	reachable := true
	q := NewQuotes(func(uint64) (*ethclient.Client, error) {
		if !reachable {
			return nil, errors.New("rpc down")
		}
		return client, nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		q.Keep(ctx, []uint64{chaintest.ChainID})
		close(stopped)
	}()
	for wait := time.Now().Add(10 * time.Second); ; time.Sleep(10 * time.Millisecond) {
		q.mu.Lock()
		_, kept := q.kept[chaintest.ChainID]
		q.mu.Unlock()
		if kept {
			break
		}
		if time.Now().After(wait) {
			t.Fatal("Keep read no quote at start")
		}
	}
	cancel()
	<-stopped
	reachable = false
	q.kept[chaintest.ChainID] = quote{usd: q.kept[chaintest.ChainID].usd, at: time.Now().Add(-QuoteAge)}
	if _, err := q.NetworkFee(context.Background(), chaintest.ChainID); err != nil {
		t.Fatalf("a new invoice with the RPC down after a restart: %v", err)
	}
}
