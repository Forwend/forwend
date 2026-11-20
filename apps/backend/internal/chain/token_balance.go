package chain

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
)

// An empty token call cannot establish a zero balance.
var ErrNoToken = errors.New("no token contract at the block")

var TransferTopic = crypto.Keccak256Hash([]byte("Transfer(address,address,uint256)"))

func TokenBalanceAt(ctx context.Context, client *ethclient.Client, chainID uint64, token, holder string,
	block uint64) (*big.Int, error) {
	to := common.HexToAddress(token)
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &to, Data: balanceOf(holder)}, new(big.Int).SetUint64(block))
	if err != nil {
		return nil, fmt.Errorf("balanceOf %s on chain %d: %w", holder, chainID, err)
	}
	return tokenAmount(out, chainID, holder)
}

func TokenBalanceAtHash(ctx context.Context, client *ethclient.Client, chainID uint64, token, holder string, block common.Hash) (*big.Int, error) {
	out, err := CallAtHash(ctx, client, common.HexToAddress(token), balanceOf(holder), block)
	if err != nil {
		return nil, fmt.Errorf("balanceOf %s on chain %d: %w", holder, chainID, err)
	}
	return tokenAmount(out, chainID, holder)
}

// A failover must read the same canonical block, never another fork at the same height.
func CallAtHash(ctx context.Context, client *ethclient.Client, to common.Address, data []byte, block common.Hash) ([]byte, error) {
	var out hexutil.Bytes
	err := client.Client().CallContext(ctx, &out, "eth_call", map[string]any{"to": to, "data": hexutil.Bytes(data)}, rpc.BlockNumberOrHashWithHash(block, true))
	return out, err
}

func balanceOf(holder string) []byte {
	return append(common.FromHex("0x70a08231"), common.LeftPadBytes(common.HexToAddress(holder).Bytes(), 32)...)
}

func tokenAmount(out []byte, chainID uint64, holder string) (*big.Int, error) {
	switch len(out) {
	case 0:
		return nil, fmt.Errorf("balanceOf %s on chain %d: %w", holder, chainID, ErrNoToken)
	case 32:
		return new(big.Int).SetBytes(out), nil
	}
	return nil, fmt.Errorf("balanceOf %s on chain %d: %d-byte answer", holder, chainID, len(out))
}
