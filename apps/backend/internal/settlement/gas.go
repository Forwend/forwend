package settlement

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
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
	tempoFeeManager = chain.TempoFeeManager
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
	token, tempo, err := UserFeeToken(ctx, client, executor)
	if err != nil || !tempo {
		return common.Address{}, err
	}
	if token != (common.Address{}) {
		return token, nil
	}
	return pathUSD, nil
}

// UserFeeToken is the fee token the account chose in Tempo's fee manager, the zero address for none; tempo is false
// on a chain without the fee manager.
func UserFeeToken(ctx context.Context, client *ethclient.Client, account common.Address) (token common.Address,
	tempo bool, err error) {
	code, err := client.CodeAt(ctx, tempoFeeManager, nil)
	if err != nil {
		return common.Address{}, false, fmt.Errorf("read the fee manager's code: %w", err)
	}
	if len(code) == 0 {
		return common.Address{}, false, nil
	}
	data := append(append([]byte{}, userTokens...), common.LeftPadBytes(account.Bytes(), 32)...)
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &tempoFeeManager, Data: data}, nil)
	if err != nil {
		return common.Address{}, true, fmt.Errorf("read the account's fee token: %w", err)
	}
	if len(out) != 32 {
		return common.Address{}, true, fmt.Errorf("read the account's fee token: %d-byte answer", len(out))
	}
	return common.BytesToAddress(out), true, nil
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

// swapRoutes is where the signer buys ether with the USDC network fees it is paid (R-229): Uniswap v3's SwapRouter02
// and its WETH, swapping native USDC in the USDC/WETH pool of the fee tier. Checked on 2026-11-09 against Uniswap's
// deployment docs and each router's factory() and WETH9(). The 0.05% pools then held 1.2M (Base) and 6.8M (Arbitrum)
// USDC: deep enough for a top-up, at the lowest fee. Arc and Tempo pay gas in the stablecoin itself.
var swapRoutes = map[uint64]swapRoute{
	8453: {router: common.HexToAddress("0x2626664c2603336E57B271c5C0b26F421741e481"),
		weth: common.HexToAddress("0x4200000000000000000000000000000000000006"),
		usdc: common.HexToAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), fee: 500},
	42161: {router: common.HexToAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"),
		weth: common.HexToAddress("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),
		usdc: common.HexToAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"), fee: 500},
}

type swapRoute struct {
	router, weth, usdc common.Address
	fee                int64 // the pool's fee tier, in millionths
}

// A swap buys at least the ether the Chainlink price gives, less swapSlack percent (R-229). It brings the executor to
// topUpSettlements deploys and settles, so one swap lasts many alert periods.
const (
	swapSlack        = 1
	topUpSettlements = 2 * GasAlertSettlements
)

// SwapRouter02's IV3SwapRouter.exactInputSingle has no deadline; multicall's carries it.
var routerABI = func() abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(`[
	{"type":"function","name":"multicall","inputs":[{"name":"deadline","type":"uint256"},{"name":"data","type":"bytes[]"}]},
	{"type":"function","name":"exactInputSingle","inputs":[{"name":"params","type":"tuple","components":[
		{"name":"tokenIn","type":"address"},{"name":"tokenOut","type":"address"},{"name":"fee","type":"uint24"},
		{"name":"recipient","type":"address"},{"name":"amountIn","type":"uint256"},
		{"name":"amountOutMinimum","type":"uint256"},{"name":"sqrtPriceLimitX96","type":"uint160"}]}]},
	{"type":"function","name":"unwrapWETH9","inputs":[{"name":"amountMinimum","type":"uint256"}]}]`))
	if err != nil {
		panic(err)
	}
	return parsed
}()

type exactInputSingle struct {
	TokenIn, TokenOut          common.Address
	Fee                        *big.Int
	Recipient                  common.Address
	AmountIn, AmountOutMinimum *big.Int
	SqrtPriceLimitX96          *big.Int
}

// The router's Constants.ADDRESS_THIS: the swap leaves the WETH with the router, whose unwrapWETH9 pays the caller.
var routerItself = common.HexToAddress("0x0000000000000000000000000000000000000002")

// buyGas swaps USDC for the ether that brings the executor to topUpSettlements deploys and settles at the current fee
// cap, or all its USDC if that buys less, and unwraps it in the same transaction. The router reverts unless the swap
// pays at least the Chainlink price less swapSlack, so a moved or lying pool takes no more. A swap its gas estimate
// refuses is never sent, and its approve is spent by the next one instead of sent again.
func (s *Signer) buyGas(ctx context.Context, client *ethclient.Client, chainID uint64, route swapRoute) error {
	mined, err := client.NonceAt(ctx, s.sender, nil)
	if err != nil {
		return fmt.Errorf("read executor nonce: %w", err)
	}
	pending, err := client.PendingNonceAt(ctx, s.sender)
	if err != nil {
		return fmt.Errorf("read executor nonce: %w", err)
	}
	if pending > mined {
		// An approve stacked behind a stuck transaction would hold a nonce and buy nothing.
		return fmt.Errorf("a transaction at nonce %d is not mined yet: buying next round", mined)
	}
	_, feeCap, err := Fees(ctx, client, chainID)
	if err != nil {
		return err
	}
	have, err := client.BalanceAt(ctx, s.sender, nil)
	if err != nil {
		return fmt.Errorf("read the executor's balance: %w", err)
	}
	want := new(big.Int).Sub(new(big.Int).Mul(feeCap, big.NewInt(MinGas*topUpSettlements)), have)
	if want.Sign() <= 0 {
		return nil
	}
	price, err := chain.EthPrice(ctx, client, chainID)
	if err != nil {
		return err
	}
	head, err := client.HeaderByNumber(ctx, nil)
	if err != nil {
		return fmt.Errorf("read the latest block: %w", err)
	}
	held, err := chain.TokenBalanceAt(ctx, client, chainID, route.usdc.Hex(), s.sender.Hex(), head.Number.Uint64())
	if err != nil {
		return err
	}
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &route.usdc, Data: append(append(
		selector("allowance(address,address)"), common.LeftPadBytes(s.sender.Bytes(), 32)...),
		common.LeftPadBytes(route.router.Bytes(), 32)...)}, nil)
	if err != nil || len(out) != 32 {
		return fmt.Errorf("read the router's USDC allowance: %d bytes, %v", len(out), err)
	}
	// Less than one deploy and settle's gas costs more than it buys, and the pool's rounding can refuse it. Approved,
	// dust anyone sent the executor would cap every later swap.
	floor := new(big.Int).Mul(feeCap, big.NewInt(MinGas))
	// An allowance a refused swap left is swapped before any new approve, when it buys enough on its own; a smaller one
	// is replaced.
	in, least := swapAmounts(want, minBig(held, new(big.Int).SetBytes(out)), price)
	approve := least.Cmp(floor) < 0
	if approve {
		if in, least = swapAmounts(want, held, price); least.Cmp(floor) < 0 {
			return fmt.Errorf("%s USDC to swap buys less than one deploy and settle", usd(held))
		}
	}
	var after uint64
	if approve {
		// Only what this swap takes: a router bug or a swap never sent can't reach more of the executor's USDC.
		data := append(append(selector("approve(address,uint256)"), common.LeftPadBytes(route.router.Bytes(), 32)...),
			common.LeftPadBytes(in.Bytes(), 32)...)
		tx, err := s.sendAndWait(ctx, client, chainID, route.usdc, data, 0)
		if err != nil {
			return fmt.Errorf("approve the router: %w", err)
		}
		after = tx.Nonce() + 1
	}
	swap, err := routerABI.Pack("exactInputSingle", exactInputSingle{TokenIn: route.usdc, TokenOut: route.weth,
		Fee: big.NewInt(route.fee), Recipient: routerItself, AmountIn: in, AmountOutMinimum: least,
		SqrtPriceLimitX96: new(big.Int)})
	if err != nil {
		return err
	}
	unwrap, err := routerABI.Pack("unwrapWETH9", least)
	if err != nil {
		return err
	}
	// Mined later than this, it reverts: the price it was bounded by is old.
	deadline := new(big.Int).SetUint64(head.Time + uint64(GasCheckEvery/time.Second))
	data, err := routerABI.Pack("multicall", deadline, [][]byte{swap, unwrap})
	if err != nil {
		return err
	}
	tx, err := s.sendAndWait(ctx, client, chainID, route.router, data, after)
	if err != nil {
		return fmt.Errorf("swap: %w", err)
	}
	slog.Info("executor bought ether for gas", "chain", chainID, "usdc", usd(in), "ether_at_least", ether(least),
		"tx", tx.Hash().Hex())
	return nil
}

// swapAmounts: in is the USDC that buys wei of ether at price (USD per ether, chain.EthUSDDecimals decimals), rounded
// up and at most held, taking USDC at 1 USD; least is the ether in must buy, less swapSlack percent, rounded down.
func swapAmounts(wei, held, price *big.Int) (in, least *big.Int) {
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(18+chain.EthUSDDecimals-6), nil)
	in = new(big.Int).Mul(wei, price)
	in.Add(in, new(big.Int).Sub(scale, big.NewInt(1))).Div(in, scale)
	if in.Cmp(held) > 0 {
		in.Set(held)
	}
	least = new(big.Int).Mul(in, scale)
	least.Mul(least, big.NewInt(100-swapSlack)).Div(least, new(big.Int).Mul(price, big.NewInt(100)))
	return in, least
}

// sendAndWait signs at the executor's next nonce, at least after, and waits for the transaction to succeed. One not
// mined in ReceiptWait stays unsaved: the next deploy replaces it if it holds the nonce (overStuck).
func (s *Signer) sendAndWait(ctx context.Context, client *ethclient.Client, chainID uint64, to common.Address,
	data []byte, after uint64) (*types.Transaction, error) {
	tx, err := s.sign(ctx, client, chainID, to, data, after, 0, nil)
	if err != nil {
		return nil, err
	}
	if err := client.SendTransaction(ctx, tx); err != nil {
		return nil, fmt.Errorf("send %s: %w", tx.Hash().Hex(), err)
	}
	r, err := s.await(ctx, client, tx.Hash())
	switch {
	case err != nil:
		return nil, err
	case r == nil:
		return nil, fmt.Errorf("%s not mined in %s", tx.Hash().Hex(), ReceiptWait)
	case r.Status != types.ReceiptStatusSuccessful:
		return nil, fmt.Errorf("%s reverted", tx.Hash().Hex())
	}
	return tx, nil
}

func usd(units *big.Int) string {
	s := new(big.Rat).SetFrac(units, big.NewInt(1e6)).FloatString(6)
	return strings.TrimSuffix(strings.TrimRight(s, "0"), ".")
}

func ether(wei *big.Int) string {
	s := new(big.Rat).SetFrac(wei, big.NewInt(1e18)).FloatString(18)
	return strings.TrimSuffix(strings.TrimRight(s, "0"), ".")
}
