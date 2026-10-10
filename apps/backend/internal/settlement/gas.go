package settlement

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// MinGas is the gas for settling one invoice: a receiver deploy (159,990 gas on Anvil) and a settle (at least
// SettleGasFloor), each signed with a fifth more. The signer starts only when the executor can pay it on every enabled
// chain at the fee cap it would sign with now (CheckGas). On Arbitrum gas also counts the L1 data cost, which this
// does not cover: it is a floor, not a budget.
const MinGas = (160_000 + SettleGasFloor) * 6 / 5

// CheckGas returns an error unless the executor holds MinGas at the chain's current fee cap: below that the node
// refuses the signer's next deploy and settle. The error names the chain, the executor's address and its balance.
func CheckGas(ctx context.Context, client *ethclient.Client, chainID uint64, executor common.Address) error {
	_, feeCap, err := fees(ctx, client, chainID)
	if err != nil {
		return fmt.Errorf("chain %d: %w", chainID, err)
	}
	need := new(big.Int).Mul(feeCap, big.NewInt(MinGas))
	have, err := client.BalanceAt(ctx, executor, nil)
	if err != nil {
		return fmt.Errorf("chain %d: read the executor's balance: %w", chainID, err)
	}
	if have.Cmp(need) < 0 {
		return fmt.Errorf("chain %d: executor %s holds %s of the native coin, below the %s that one deploy and settle "+
			"cost at the current gas price: fund it", chainID, executor.Hex(), ether(have), ether(need))
	}
	return nil
}

// ether writes wei in whole coins (18 decimals), exactly.
func ether(wei *big.Int) string {
	s := new(big.Rat).SetFrac(wei, big.NewInt(1e18)).FloatString(18)
	return strings.TrimSuffix(strings.TrimRight(s, "0"), ".")
}
