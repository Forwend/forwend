package chain

import (
	"context"
	"errors"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/ethclient"
)

type Block struct {
	Number uint64
	Hash   common.Hash
}

// Preserve the RPC hash: recomputing Ethereum headers gives a different hash on Tempo.
func Finalized(ctx context.Context, client *ethclient.Client) (Block, error) {
	var head *struct {
		Number *hexutil.Uint64
		Hash   common.Hash
	}
	if err := client.Client().CallContext(ctx, &head, "eth_getBlockByNumber", "finalized", false); err != nil {
		return Block{}, err
	}
	if head == nil || head.Number == nil || head.Hash == (common.Hash{}) {
		return Block{}, errors.New("invalid finalized header")
	}
	return Block{Number: uint64(*head.Number), Hash: head.Hash}, nil
}
