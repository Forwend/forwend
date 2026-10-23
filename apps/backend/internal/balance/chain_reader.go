package balance

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
)

const (
	// With 3 s the balance label is at most 3 s behind, and any number of users costs one header read per chain per 3 s.
	finalizedTTL = 3 * time.Second
	// A balance at a finalized block never changes; this only frees the memory of blocks no longer finalized.
	balanceTTL = time.Minute
)

// ChainReader reads with each chain's second RPC (D-15); a slow chain never holds up another.
type ChainReader struct {
	rpcs    map[uint64]chain.RPCs
	errs    map[uint64]error // chains whose RPC list can't confirm balances
	clients map[uint64]*ethclient.Client
	cache   cache
}

// NewChainReader sends each RPC at most rate calls per second.
func NewChainReader(specs map[uint64]chain.Spec, keys []string, rate float64) *ChainReader {
	c := &ChainReader{rpcs: map[uint64]chain.RPCs{}, errs: map[uint64]error{}, clients: map[uint64]*ethclient.Client{},
		cache: newMemoryCache()}
	for id, spec := range specs {
		r, err := chain.NewRPCs(spec, keys, rate)
		if err != nil {
			c.errs[id] = err
			continue
		}
		c.rpcs[id], c.clients[id] = r, ethclient.NewClient(r.Second)
	}
	return c
}

// Read is a ledger.BalanceOf at the second RPC's finalized block. Requests share one finalized read per chain per
// finalizedTTL and one balanceOf per block, so a balance is always the one at the block it is returned with.
func (c *ChainReader) Read(ctx context.Context, chainID uint64, token, holder string) (*big.Int, uint64, error) {
	if err := c.errs[chainID]; err != nil {
		return nil, 0, err
	}
	client, ok := c.clients[chainID]
	if !ok {
		return nil, 0, fmt.Errorf("no balance RPC for chain %d", chainID)
	}
	head, err := c.cache.get(ctx, fmt.Sprintf("finalized/%d", chainID), finalizedTTL,
		func(ctx context.Context) (string, error) {
			final, err := client.HeaderByNumber(ctx, big.NewInt(int64(rpc.FinalizedBlockNumber)))
			if err != nil {
				return "", fmt.Errorf("chain %d: read finalized block: %w", chainID, err)
			}
			return final.Number.String(), nil
		})
	if err != nil {
		return nil, 0, err
	}
	block, _ := strconv.ParseUint(head, 10, 64) // the cache holds what the read above returned
	raw, err := c.cache.get(ctx, fmt.Sprintf("balance/%d/%s/%s/%d", chainID, token, holder, block), balanceTTL,
		func(ctx context.Context) (string, error) {
			balance, err := ledger.BalanceAt(ctx, client, chainID, token, holder, block)
			if errors.Is(err, ledger.ErrNoToken) {
				balance, err = new(big.Int), nil // a token deployed after that block holds nothing there
			}
			if err != nil {
				return "", err
			}
			return balance.String(), nil
		})
	if err != nil {
		return nil, 0, err
	}
	balance, _ := new(big.Int).SetString(raw, 10)
	return balance, block, nil
}

func (c *ChainReader) Close() {
	for _, r := range c.rpcs {
		r.Close()
	}
}
