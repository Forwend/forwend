package balance

import (
	"context"
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
	// finalizedTTL is how long one read of a chain's finalized block serves every request. The web reads balances
	// every 15 s; with 3 s the label is at most 3 s behind the chain, and any number of users costs one header read per
	// chain per 3 s.
	finalizedTTL = 3 * time.Second
	// balanceTTL is how long a balance read at a block is kept. A balance at a finalized block never changes, so this
	// only frees the memory of blocks that are no longer the finalized one; a block that still is gets read again.
	balanceTTL = time.Minute
)

// ChainReader reads wallet balances with each chain's second RPC (D-15). Each chain's RPCs rest and switch on their
// own (chain.NewRPCs), so a slow chain never holds up another.
type ChainReader struct {
	rpcs    map[uint64]chain.RPCs
	errs    map[uint64]error // chains whose RPC list can't confirm balances
	clients map[uint64]*ethclient.Client
	cache   cache
}

// NewChainReader reads the chains in specs through their Infura keys (where a chain lists Infura) and public RPCs,
// sending each at most rate calls per second.
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

// Read is a ledger.BalanceOf: the holder's token balance at the second RPC's finalized block. Requests share the
// reads: one finalized block read per chain every finalizedTTL, and one balanceOf per chain, token, holder and block,
// so a balance is always the one at the block it is returned with.
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

// Close closes every chain's RPC clients.
func (c *ChainReader) Close() {
	for _, r := range c.rpcs {
		r.Close()
	}
}
