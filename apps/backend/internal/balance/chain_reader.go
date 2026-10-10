package balance

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ethereum/go-ethereum/ethclient"
)

// RetryPick is how long a chain whose RPCs could not be picked answers with an error before it is picked again, so a
// dead chain is not dialed on every request.
const RetryPick = 30 * time.Second

// ChainReader reads wallet balances with each chain's second RPC (D-15), picked on first use like the worker does,
// and picked again after a failed read. Each chain has its own lock, so a slow chain never holds up another.
type ChainReader struct {
	specs map[uint64]chain.Spec
	keys  []string

	mu     sync.Mutex // guards chains
	chains map[uint64]*chainRPCs
}

type chainRPCs struct {
	mu       sync.Mutex
	rpcs     *chain.RPCs // nil until picked
	failed   error       // the last pick's error, answered until failedAt + RetryPick
	failedAt time.Time
}

// NewChainReader reads the chains in specs, dialing Infura with keys where a chain lists it.
func NewChainReader(specs map[uint64]chain.Spec, keys []string) *ChainReader {
	return &ChainReader{specs: specs, keys: keys, chains: map[uint64]*chainRPCs{}}
}

// Read is a ledger.BalanceOf: the holder's token balance at the second RPC's finalized block.
func (c *ChainReader) Read(ctx context.Context, chainID uint64, token, holder string) (*big.Int, uint64, error) {
	spec, ok := c.specs[chainID]
	if !ok {
		return nil, 0, fmt.Errorf("chain %d is not in the chain list", chainID)
	}
	c.mu.Lock()
	ch, ok := c.chains[chainID]
	if !ok {
		ch = &chainRPCs{}
		c.chains[chainID] = ch
	}
	c.mu.Unlock()

	r, err := ch.pick(ctx, spec, c.keys)
	if err != nil {
		return nil, 0, err
	}
	balance, block, err := ledger.BalanceFrom(map[uint64]*ethclient.Client{chainID: ethclient.NewClient(r.Second)})(
		ctx, chainID, token, holder)
	if err != nil && !cancelled(ctx) { // the RPC failed or was too slow: pick again next time
		ch.mu.Lock()
		if ch.rpcs == r {
			r.Close()
			ch.rpcs = nil
		}
		ch.mu.Unlock()
	}
	return balance, block, err
}

func (ch *chainRPCs) pick(ctx context.Context, spec chain.Spec, keys []string) (*chain.RPCs, error) {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if ch.rpcs != nil {
		return ch.rpcs, nil
	}
	if ch.failed != nil && time.Since(ch.failedAt) < RetryPick {
		return nil, ch.failed
	}
	r, err := chain.Dial(ctx, spec, keys)
	if err != nil {
		if !cancelled(ctx) {
			ch.failed, ch.failedAt = err, time.Now()
		}
		return nil, errors.Join(err, ctx.Err())
	}
	ch.rpcs, ch.failed = &r, nil
	return ch.rpcs, nil
}

// cancelled reports a request its client gave up on: that says nothing about the chain. A deadline does: the chain was
// too slow.
func cancelled(ctx context.Context) bool {
	return errors.Is(ctx.Err(), context.Canceled)
}

// Close closes every picked chain's RPC clients.
func (c *ChainReader) Close() {
	for _, ch := range c.chains {
		if ch.rpcs != nil {
			ch.rpcs.Close()
		}
	}
}
