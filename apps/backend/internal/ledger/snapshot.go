package ledger

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
)

// BalanceSnapshot shares the second provider's finalized header within one sequential ledger round.
// A new round gets a new snapshot; failed header reads are never kept.
func BalanceSnapshot(client *ethclient.Client) BalanceOf {
	var block *big.Int
	return func(ctx context.Context, chainID uint64, token, holder string) (*big.Int, uint64, error) {
		if block == nil {
			head, err := client.HeaderByNumber(ctx, big.NewInt(int64(rpc.FinalizedBlockNumber)))
			if err != nil {
				return nil, 0, fmt.Errorf("read chain %d finalized block: %w", chainID, err)
			}
			block = head.Number
		}
		value, err := BalanceAt(ctx, client, chainID, token, holder, block.Uint64())
		return value, block.Uint64(), err
	}
}
