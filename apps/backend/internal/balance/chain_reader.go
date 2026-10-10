package balance

import (
	"context"
	"math/big"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ethereum/go-ethereum/ethclient"
)

// ChainReader reads wallet balances with each chain's second RPC (D-15). Each chain's RPCs rest and switch on their
// own (chain.NewRPCs), so a slow chain never holds up another.
type ChainReader struct {
	rpcs map[uint64]chain.RPCs
	errs map[uint64]error // chains whose RPC list can't confirm balances
	read ledger.BalanceOf
}

// NewChainReader reads the chains in specs through their Infura keys (where a chain lists Infura) and public RPCs,
// sending each at most rate calls per second.
func NewChainReader(specs map[uint64]chain.Spec, keys []string, rate float64) *ChainReader {
	c := &ChainReader{rpcs: map[uint64]chain.RPCs{}, errs: map[uint64]error{}}
	clients := map[uint64]*ethclient.Client{}
	for id, spec := range specs {
		r, err := chain.NewRPCs(spec, keys, rate)
		if err != nil {
			c.errs[id] = err
			continue
		}
		c.rpcs[id], clients[id] = r, ethclient.NewClient(r.Second)
	}
	c.read = ledger.BalanceFrom(clients)
	return c
}

// Read is a ledger.BalanceOf: the holder's token balance at the second RPC's finalized block.
func (c *ChainReader) Read(ctx context.Context, chainID uint64, token, holder string) (*big.Int, uint64, error) {
	if err := c.errs[chainID]; err != nil {
		return nil, 0, err
	}
	return c.read(ctx, chainID, token, holder)
}

// Close closes every chain's RPC clients.
func (c *ChainReader) Close() {
	for _, r := range c.rpcs {
		r.Close()
	}
}
