package settlement

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// MinGas is the gas for settling one invoice: a receiver deploy (159,990 gas on Anvil) and a settle (at least
// SettleGasFloor), each signed with a fifth more. The signer starts only when the executor can pay it on every enabled
// chain at the fee cap it would sign with now (CheckGas). On Arbitrum gas also counts the L1 data cost, which this
// does not cover: it is a floor, not a budget.
const MinGas = (160_000 + SettleGasFloor) * 6 / 5

// Tempo has no native coin and eth_getBalance there returns a placeholder: fees come out of a USD TIP-20 token, the
// fee payer's choice in the fee manager precompile or else PathUSD (tempo.xyz/developers/docs/protocol/fees/spec-fee).
var (
	tempoFeeManager = common.HexToAddress("0xfeec000000000000000000000000000000000000")
	pathUSD         = common.HexToAddress("0x20c0000000000000000000000000000000000000")
	userTokens      = crypto.Keccak256([]byte("userTokens(address)"))[:4]
)

// CheckGas returns an error unless the executor holds MinGas at the chain's current fee cap: below that the node
// refuses the signer's next deploy and settle. The error names the chain, the executor's address and its balance.
func CheckGas(ctx context.Context, client *ethclient.Client, chainID uint64, executor common.Address) error {
	_, feeCap, err := fees(ctx, client, chainID)
	if err != nil {
		return fmt.Errorf("chain %d: %w", chainID, err)
	}
	need := new(big.Int).Mul(feeCap, big.NewInt(MinGas))
	token, err := feeToken(ctx, client, executor)
	if err != nil {
		return fmt.Errorf("chain %d: %w", chainID, err)
	}
	if token != (common.Address{}) {
		return checkFeeToken(ctx, client, chainID, executor, token, need)
	}
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

// feeToken is the TIP-20 token the executor pays fees in on a chain with Tempo's fee manager, or the zero address on a
// chain that charges gas in its native coin.
func feeToken(ctx context.Context, client *ethclient.Client, executor common.Address) (common.Address, error) {
	code, err := client.CodeAt(ctx, tempoFeeManager, nil)
	if err != nil {
		return common.Address{}, fmt.Errorf("read the fee manager's code: %w", err)
	}
	if len(code) == 0 {
		return common.Address{}, nil
	}
	data := append(append([]byte{}, userTokens...), common.LeftPadBytes(executor.Bytes(), 32)...)
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &tempoFeeManager, Data: data}, nil)
	if err != nil {
		return common.Address{}, fmt.Errorf("read the executor's fee token: %w", err)
	}
	if len(out) != 32 {
		return common.Address{}, fmt.Errorf("read the executor's fee token: %d-byte answer", len(out))
	}
	if token := common.BytesToAddress(out); token != (common.Address{}) {
		return token, nil
	}
	return pathUSD, nil
}

// checkFeeToken is CheckGas in a fee token: gas prices are in attodollars and the token has 6 decimals, so the fee is
// ceil(price × gas / 10^12) base units.
func checkFeeToken(ctx context.Context, client *ethclient.Client, chainID uint64, executor, token common.Address,
	attodollars *big.Int) error {
	scale := big.NewInt(1e12)
	need := new(big.Int).Div(new(big.Int).Add(attodollars, new(big.Int).Sub(scale, big.NewInt(1))), scale)
	block, err := client.BlockNumber(ctx)
	if err != nil {
		return fmt.Errorf("chain %d: read the latest block: %w", chainID, err)
	}
	have, err := ledger.BalanceAt(ctx, client, chainID, token.Hex(), executor.Hex(), block)
	if err != nil {
		return fmt.Errorf("chain %d: read the executor's fee token balance: %w", chainID, err)
	}
	if have.Cmp(need) < 0 {
		return fmt.Errorf("chain %d: executor %s holds %s of fee token %s, below the %s that one deploy and settle "+
			"cost at the current gas price: fund it", chainID, executor.Hex(), usd(have), token.Hex(), usd(need))
	}
	return nil
}

// usd writes 6-decimal base units in whole tokens, exactly.
func usd(units *big.Int) string {
	s := new(big.Rat).SetFrac(units, big.NewInt(1e6)).FloatString(6)
	return strings.TrimSuffix(strings.TrimRight(s, "0"), ".")
}

// ether writes wei in whole coins (18 decimals), exactly.
func ether(wei *big.Int) string {
	s := new(big.Rat).SetFrac(wei, big.NewInt(1e18)).FloatString(18)
	return strings.TrimSuffix(strings.TrimRight(s, "0"), ".")
}
