package chain

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// EthUSD is each paymaster chain's Chainlink ETH/USD feed, 8 decimals, checked on 2026-11-08 by description().
var EthUSD = map[uint64]common.Address{
	8453:   common.HexToAddress("0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"),
	42161:  common.HexToAddress("0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612"),
	84532:  common.HexToAddress("0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1"),
	421614: common.HexToAddress("0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165"),
}

// EthUSDDecimals is the decimals of every EthUSD feed's answer.
const EthUSDDecimals = 8

var latestRoundData = common.Hex2Bytes("feaf968c")

// EthPrice reads the chain's ETH/USD feed: the dollars one ether costs, with EthUSDDecimals decimals.
func EthPrice(ctx context.Context, client *ethclient.Client, chainID uint64) (*big.Int, error) {
	feed, ok := EthUSD[chainID]
	if !ok {
		return nil, fmt.Errorf("chain %d has no ETH/USD feed", chainID)
	}
	raw, err := client.CallContract(ctx, ethereum.CallMsg{To: &feed, Data: latestRoundData}, nil)
	if err != nil {
		return nil, fmt.Errorf("read chain %d ETH/USD feed: %w", chainID, err)
	}
	if len(raw) != 5*32 {
		return nil, fmt.Errorf("chain %d ETH/USD feed answered %d bytes", chainID, len(raw))
	}
	price := new(big.Int).SetBytes(raw[32:64])
	if raw[32]&0x80 != 0 || price.Sign() == 0 {
		return nil, fmt.Errorf("chain %d ETH/USD feed answered no price", chainID)
	}
	return price, nil
}
