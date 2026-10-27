package ledger

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
)

// BalanceSnapshot shares the selected provider's finalized header within one sequential ledger round.
// A new round gets a new snapshot; failed header reads are never kept.
func BalanceSnapshot(client *ethclient.Client) BalanceOf {
	var block *chain.Block
	return func(ctx context.Context, chainID uint64, token, holder string) (*big.Int, uint64, error) {
		if block == nil {
			head, err := chain.Finalized(ctx, client)
			if err != nil {
				return nil, 0, fmt.Errorf("read chain %d finalized block: %w", chainID, err)
			}
			block = &head
		}
		value, err := chain.TokenBalanceAtHash(ctx, client, chainID, token, holder, block.Hash)
		return value, block.Number, err
	}
}
