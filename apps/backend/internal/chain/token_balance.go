package chain

import (
	"context"
	"errors"
	"fmt"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"math/big"
)

// An empty token call cannot establish a zero balance.
var ErrNoToken = errors.New("no token contract at the block")

func TokenBalanceAt(ctx context.Context, client *ethclient.Client, chainID uint64, token, holder string,
	block uint64) (*big.Int, error) {
	to := common.HexToAddress(token)
	data := append(common.FromHex("0x70a08231"), common.LeftPadBytes(common.HexToAddress(holder).Bytes(), 32)...)
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, new(big.Int).SetUint64(block))
	if err != nil {
		return nil, fmt.Errorf("balanceOf %s on chain %d: %w", holder, chainID, err)
	}
	switch len(out) {
	case 0:
		return nil, fmt.Errorf("balanceOf %s on chain %d: %w", holder, chainID, ErrNoToken)
	case 32:
		return new(big.Int).SetBytes(out), nil
	}
	return nil, fmt.Errorf("balanceOf %s on chain %d: %d-byte answer", holder, chainID, len(out))
}
