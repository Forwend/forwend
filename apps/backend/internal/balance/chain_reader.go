package balance

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
)

const (
	// One header read per chain per 3 s, however many users; the balance label is at most 3 s behind.
	finalizedTTL = 3 * time.Second
	// A balance at a finalized block never changes; this only frees the memory of blocks no longer finalized.
	balanceTTL = time.Minute
)

// ChainReader reads with each chain's RPC pool; a slow chain never holds up another.
type ChainReader struct {
	rpcs    map[uint64]chain.RPCs
	errs    map[uint64]error // chains whose RPC list can't confirm balances
	clients map[uint64]*ethclient.Client
	cache   *memoryCache
}

// NewChainReader sends each RPC at most rate calls per second.
func NewChainReader(specs map[uint64]chain.Spec, rate float64, budget *chain.Budget) *ChainReader {
	c := &ChainReader{rpcs: map[uint64]chain.RPCs{}, errs: map[uint64]error{}, clients: map[uint64]*ethclient.Client{},
		cache: newMemoryCache()}
	for id, spec := range specs {
		r, err := chain.NewRPCs(spec, rate, budget)
		if err != nil {
			c.errs[id] = err
			continue
		}
		c.rpcs[id], c.clients[id] = r, ethclient.NewClient(r.Client)
	}
	return c
}

// Client is the chain's RPC client, for reads at the latest block such as a send's checks.
func (c *ChainReader) Client(chainID uint64) (*ethclient.Client, error) {
	if err := c.errs[chainID]; err != nil {
		return nil, err
	}
	client, ok := c.clients[chainID]
	if !ok {
		return nil, fmt.Errorf("no RPC for chain %d", chainID)
	}
	return client, nil
}

// Read is a ledger.BalanceOf at the finalized block, read once per block, so it always matches its block.
func (c *ChainReader) Read(ctx context.Context, chainID uint64, token, holder string) (*big.Int, uint64, error) {
	client, err := c.Client(chainID)
	if err != nil {
		return nil, 0, err
	}
	head, err := c.cache.get(ctx, fmt.Sprintf("finalized/%d", chainID), finalizedTTL,
		func(ctx context.Context) (any, error) {
			final, err := chain.Finalized(ctx, client)
			if err != nil {
				return nil, fmt.Errorf("chain %d: read finalized block: %w", chainID, err)
			}
			return final, nil
		})
	if err != nil {
		return nil, 0, err
	}
	final := head.(chain.Block)
	balance, err := c.cache.get(ctx, fmt.Sprintf("balance/%d/%s/%s/%s", chainID, token, holder, final.Hash.Hex()), balanceTTL,
		func(ctx context.Context) (any, error) {
			balance, err := chain.TokenBalanceAtHash(ctx, client, chainID, token, holder, final.Hash)
			if errors.Is(err, chain.ErrNoToken) {
				return new(big.Int), nil // a token deployed after that block holds nothing there
			}
			return balance, err
		})
	if err != nil {
		return nil, 0, err
	}
	// Each caller gets its own copy: the cached value is shared.
	return new(big.Int).Set(balance.(*big.Int)), final.Number, nil
}

func (c *ChainReader) Close() {
	for _, r := range c.rpcs {
		r.Close()
	}
}
