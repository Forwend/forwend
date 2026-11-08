package settlement

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

// MinGas covers one receiver deploy (159,990 gas on Anvil) and one settle, each plus a fifth. On Arbitrum it
// leaves out the L1 data cost: it is a floor, not a budget.
const MinGas = (160_000 + SettleGasFloor) * 6 / 5

// Tempo's v1 testnet flow (deployments.json, superseded) used 1,305,758 gas to deploy and 572,845 to settle.
const TempoMinGas = (1_310_000 + 575_000) * 6 / 5

// maxFeePerGas bounds what one unit of gas may cost on each chain, in its fee unit (wei, or attodollars on Tempo), so a
// wrong or lying fee suggestion from one provider can't drain the executor (R-189). Fees on 2026-10-30 were far below:
// Base Sepolia 0.005 gwei, Arbitrum Sepolia 0.02, Arc 20 plus a 12.5 tip, Tempo 0.6. Mainnet fees on 2026-11-08 were
// alike: Base 0.006, Arbitrum 0.02, Arc 25.75, Tempo 0.6. A chain without one is not served.
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

// GasAlertSettlements: below this many deploys and settles at the current fees, the signer alerts every GasCheckEvery.
const (
	GasAlertSettlements = 20
	GasCheckEvery       = 5 * time.Minute
)

// Tempo has no native coin (eth_getBalance is a placeholder): fees are paid in the executor's fee token, else PathUSD.
var (
	tempoFeeManager = common.HexToAddress("0xfeec000000000000000000000000000000000000")
	pathUSD         = common.HexToAddress("0x20c0000000000000000000000000000000000000")
	userTokens      = crypto.Keccak256([]byte("userTokens(address)"))[:4]
)

// CheckGas fails unless the executor holds MinGas at the chain's current fee cap. A failed read tries the next
// client; a shortfall stops the check, since the signer sends through the first.
func CheckGas(ctx context.Context, chainID uint64, executor common.Address, clients ...*ethclient.Client) error {
	var err error
	for _, client := range clients {
		if err = checkGas(ctx, client, chainID, executor, 1); err == nil || errors.Is(err, errFundIt) {
			return err
		}
	}
	return err
}

var errFundIt = errors.New("fund it")

// checkGas fails unless the executor holds the gas of settlements deploys and settles at the current fee cap.
func checkGas(ctx context.Context, client *ethclient.Client, chainID uint64, executor common.Address, settlements int64) error {
	_, feeCap, err := Fees(ctx, client, chainID)
	if err != nil {
		return fmt.Errorf("chain %d: %w", chainID, err)
	}
	token, err := feeToken(ctx, client, executor)
	if err != nil {
		return fmt.Errorf("chain %d: %w", chainID, err)
	}
	what := "one deploy and settle"
	if settlements > 1 {
		what = fmt.Sprintf("%d deploys and settles", settlements)
	}
	if token != (common.Address{}) {
		return checkFeeToken(ctx, client, chainID, executor, token,
			new(big.Int).Mul(feeCap, big.NewInt(TempoMinGas*settlements)), what)
	}
	need := new(big.Int).Mul(feeCap, big.NewInt(MinGas*settlements))
	have, err := client.BalanceAt(ctx, executor, nil)
	if err != nil {
		return fmt.Errorf("chain %d: read the executor's balance: %w", chainID, err)
	}
	if have.Cmp(need) < 0 {
		return fmt.Errorf("chain %d: executor %s holds %s of the native coin, below the %s that %s "+
			"cost at the current gas price: %w", chainID, executor.Hex(), ether(have), ether(need), what, errFundIt)
	}
	return nil
}

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

func checkFeeToken(ctx context.Context, client *ethclient.Client, chainID uint64, executor, token common.Address,
	attodollars *big.Int, what string) error {
	scale := big.NewInt(1e12) // gas prices are attodollars; the token has 6 decimals
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
		return fmt.Errorf("chain %d: executor %s holds %s of fee token %s, below the %s that %s "+
			"cost at the current gas price: %w", chainID, executor.Hex(), usd(have), token.Hex(), usd(need), what, errFundIt)
	}
	return nil
}

func usd(units *big.Int) string {
	s := new(big.Rat).SetFrac(units, big.NewInt(1e6)).FloatString(6)
	return strings.TrimSuffix(strings.TrimRight(s, "0"), ".")
}

func ether(wei *big.Int) string {
	s := new(big.Rat).SetFrac(wei, big.NewInt(1e18)).FloatString(18)
	return strings.TrimSuffix(strings.TrimRight(s, "0"), ".")
}
