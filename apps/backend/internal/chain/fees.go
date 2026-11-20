package chain

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/ethclient"
)

// maxFeePerGas caps one gas unit's price (wei; attodollars on Tempo), so a lying RPC can't drain a wallet.
var maxFeePerGas = map[uint64]*big.Int{
	8453:    big.NewInt(1e9),
	84532:   big.NewInt(1e9),
	42161:   big.NewInt(1e9),
	421614:  big.NewInt(1e9),
	5042:    big.NewInt(1000e9),
	5042002: big.NewInt(1000e9),
	4217:    big.NewInt(100e9),
	42431:   big.NewInt(100e9),
	31337:   big.NewInt(1000e9), // Anvil, in tests
	31338:   big.NewInt(1000e9), // a second Anvil, in tests
}

// FeeCeiling returns a copy of the chain's gas price cap; nil means the chain is not served.
func FeeCeiling(chainID uint64) *big.Int {
	if c, ok := maxFeePerGas[chainID]; ok {
		return new(big.Int).Set(c)
	}
	return nil
}

// Fees are a transaction's tip and fee cap: twice the base fee plus the tip, at most FeeCeiling.
func Fees(ctx context.Context, client *ethclient.Client, chainID uint64) (tip, feeCap *big.Int, err error) {
	tip, err = client.SuggestGasTipCap(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("read gas tip: %w", err)
	}
	head, err := client.HeaderByNumber(ctx, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("read base fee: %w", err)
	}
	if head.BaseFee == nil {
		return nil, nil, fmt.Errorf("chain %d has no base fee (EIP-1559)", chainID)
	}
	ceiling := FeeCeiling(chainID)
	if ceiling == nil {
		return nil, nil, fmt.Errorf("chain %d has no fee ceiling (chain.maxFeePerGas)", chainID)
	}
	feeCap = new(big.Int).Add(new(big.Int).Mul(head.BaseFee, big.NewInt(2)), tip)
	if feeCap.Cmp(ceiling) > 0 {
		feeCap = ceiling
	}
	if tip.Cmp(feeCap) > 0 {
		tip = new(big.Int).Set(feeCap)
	}
	return tip, feeCap, nil
}
