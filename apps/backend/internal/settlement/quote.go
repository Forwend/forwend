package settlement

import (
	"context"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
)

// NetworkFeeMargin: an invoice's network fee is quoted when it is made and paid at settlement, which can be days later,
// so gas may cost this many times more before the executor pays more than it is paid (R-227).
const NetworkFeeMargin = 2

// QuoteAge is how long one chain's quote serves its new invoices. A read that fails then falls back on the last good
// quote while it is younger than QuoteStale, so one slow RPC doesn't stop invoices.
const (
	QuoteAge   = time.Minute
	QuoteStale = time.Hour
)

// NetworkFeeMax bounds a quote: real ones are cents, so more is a lying RPC or price feed, never put in terms (D-122).
var NetworkFeeMax = big.NewRat(1, 1)

// Quotes prices one receiver deploy and settle on each chain in USD, for the network fee in an invoice's terms (D-122).
type Quotes struct {
	client func(chainID uint64) (*ethclient.Client, error)
	mu     sync.Mutex
	kept   map[uint64]quote
}

type quote struct {
	usd *big.Rat
	at  time.Time
}

func NewQuotes(client func(chainID uint64) (*ethclient.Client, error)) *Quotes {
	return &Quotes{client: client, kept: map[uint64]quote{}}
}

// NetworkFee is what a deploy and a settle cost at the chain's current fee cap, times NetworkFeeMargin, rounded up to
// 0.01 USD. Tempo prices gas in attodollars and Arc in its 18-decimal native USDC; ETH/USD prices ether elsewhere.
func (q *Quotes) NetworkFee(ctx context.Context, chainID uint64) (*big.Rat, error) {
	q.mu.Lock()
	kept, ok := q.kept[chainID]
	q.mu.Unlock()
	if ok && time.Since(kept.at) < QuoteAge {
		return kept.usd, nil
	}
	usd, err := q.read(ctx, chainID)
	if err != nil {
		if ok && time.Since(kept.at) < QuoteStale {
			return kept.usd, nil
		}
		return nil, err
	}
	q.mu.Lock()
	q.kept[chainID] = quote{usd: usd, at: time.Now()}
	q.mu.Unlock()
	return usd, nil
}

func (q *Quotes) read(ctx context.Context, chainID uint64) (*big.Rat, error) {
	client, err := q.client(chainID)
	if err != nil {
		return nil, err
	}
	_, feeCap, err := Fees(ctx, client, chainID)
	if err != nil {
		return nil, fmt.Errorf("quote chain %d network fee: %w", chainID, err)
	}
	code, err := client.CodeAt(ctx, tempoFeeManager, nil)
	if err != nil {
		return nil, fmt.Errorf("quote chain %d network fee: read the fee manager's code: %w", chainID, err)
	}
	gas := int64(MinGas)
	if len(code) > 0 {
		gas = TempoMinGas
	}
	cost := new(big.Rat).SetFrac(new(big.Int).Mul(feeCap, big.NewInt(gas*NetworkFeeMargin)), big.NewInt(1e18))
	if _, priced := chain.EthUSD[chainID]; priced {
		price, err := chain.EthPrice(ctx, client, chainID)
		if err != nil {
			return nil, fmt.Errorf("quote chain %d network fee: %w", chainID, err)
		}
		cost.Mul(cost, new(big.Rat).SetFrac(price, new(big.Int).Exp(big.NewInt(10), big.NewInt(chain.EthUSDDecimals), nil)))
	}
	usd := CeilCents(cost)
	if usd.Cmp(NetworkFeeMax) > 0 {
		return nil, fmt.Errorf("quote chain %d network fee: %s USD is over the %s USD a settlement can cost", chainID,
			usd.FloatString(2), NetworkFeeMax.FloatString(2))
	}
	return usd, nil
}

// CeilCents rounds a positive USD amount up to the next 0.01, and 0 up to 0.01: no settlement is free.
func CeilCents(usd *big.Rat) *big.Rat {
	cents := new(big.Rat).Mul(usd, big.NewRat(100, 1))
	n := new(big.Int).Quo(cents.Num(), cents.Denom())
	if new(big.Rat).SetInt(n).Cmp(cents) < 0 || n.Sign() == 0 {
		n.Add(n, big.NewInt(1))
	}
	return new(big.Rat).SetFrac(n, big.NewInt(100))
}
