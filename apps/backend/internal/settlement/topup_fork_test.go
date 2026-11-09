//go:build mainnetfork

package settlement

import (
	"log/slog"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
)

// On forks of Base and Arbitrum through their public RPCs:
// go test -tags mainnetfork -run TestExecutorBuysGasOnAMainnetFork ./internal/settlement/
func TestExecutorBuysGasOnAMainnetFork(t *testing.T) {
	for _, c := range []struct {
		name, url string
		id        uint64
		holder    string // the USDC/WETH 0.3% pool: USDC outside the pool the swap uses
	}{
		{"base", "https://mainnet.base.org", 8453, "0x6c561B446416E1A00E8E93E221854d6eA4171372"},
		{"arbitrum", "https://arb1.arbitrum.io/rpc", 42161, "0xc473e2aEE3441BF9240Be85eb122aBB059A3B57c"},
	} {
		t.Run(c.name, func(t *testing.T) {
			ctx := t.Context()
			pool, err := database.Open(ctx, databasetest.Migrated(t, database.Migrate))
			if err != nil {
				t.Fatal(err)
			}
			defer pool.Close()
			a := chaintest.StartFork(t, c.url)
			client := ethclient.NewClient(a.RPC)
			key, err := crypto.GenerateKey() // a known test key may carry code on a mainnet
			if err != nil {
				t.Fatal(err)
			}
			s := NewSigner(pool, key, map[uint64]*ethclient.Client{c.id: client})
			route := swapRoutes[c.id]
			usdcHeld := func() *big.Int {
				t.Helper()
				n, err := client.BlockNumber(ctx)
				if err != nil {
					t.Fatal(err)
				}
				held, err := chain.TokenBalanceAt(ctx, client, c.id, route.usdc.Hex(), s.sender.Hex(), n)
				if err != nil {
					t.Fatal(err)
				}
				return held
			}
			etherHeld := func() *big.Int {
				t.Helper()
				wei, err := client.BalanceAt(ctx, s.sender, nil)
				if err != nil {
					t.Fatal(err)
				}
				return wei
			}
			// Five deploys and settles' worth: below the alert's 20, enough to pay for the swap.
			drain := func() {
				t.Helper()
				_, feeCap, err := Fees(ctx, client, c.id)
				if err != nil {
					t.Fatal(err)
				}
				low := new(big.Int).Mul(feeCap, big.NewInt(MinGas*5))
				if err := a.RPC.Call(nil, "anvil_setBalance", s.sender, hexutil.EncodeBig(low)); err != nil {
					t.Fatal(err)
				}
				s.gasCheckedAt = time.Time{}
			}
			run := func() string {
				t.Helper()
				var logs strings.Builder
				defer slog.SetDefault(slog.Default())
				slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
				if err := s.Run(ctx); err != nil {
					t.Fatal(err)
				}
				t.Log(logs.String())
				return logs.String()
			}
			a.As(c.holder, route.usdc.Hex(), "transfer(address,uint256)", s.sender.Hex(), "100000000") // 100 USDC
			drain()

			t.Run("buys at least the Chainlink price less 1%", func(t *testing.T) {
				_, feeCap, err := Fees(ctx, client, c.id)
				if err != nil {
					t.Fatal(err)
				}
				price, err := chain.EthPrice(ctx, client, c.id)
				if err != nil {
					t.Fatal(err)
				}
				usdcBefore, etherBefore := usdcHeld(), etherHeld()
				start, err := client.BlockNumber(ctx)
				if err != nil {
					t.Fatal(err)
				}
				want := new(big.Int).Sub(new(big.Int).Mul(feeCap, big.NewInt(MinGas*topUpSettlements)), etherBefore)
				in, least := swapAmounts(want, usdcBefore, price)
				logs := run()
				if strings.Contains(logs, "ALERT") || !strings.Contains(logs, "executor bought ether for gas") {
					t.Fatal("no swap, or an alert after it")
				}
				if spent := new(big.Int).Sub(usdcBefore, usdcHeld()); spent.Cmp(in) != 0 {
					t.Fatalf("spent %s USDC units, want %s", spent, in)
				}
				// Bought: the balance gained plus the approve's and the swap's gas.
				bought := new(big.Int).Sub(etherHeld(), etherBefore)
				end, err := client.BlockNumber(ctx)
				if err != nil {
					t.Fatal(err)
				}
				var sent int
				for n := start + 1; n <= end; n++ {
					block, err := client.BlockByNumber(ctx, new(big.Int).SetUint64(n))
					if err != nil {
						t.Fatal(err)
					}
					for _, tx := range block.Transactions() {
						r, err := client.TransactionReceipt(ctx, tx.Hash())
						if err != nil {
							t.Fatal(err)
						}
						bought.Add(bought, new(big.Int).Mul(new(big.Int).SetUint64(r.GasUsed), r.EffectiveGasPrice))
						sent++
					}
				}
				if sent != 2 || bought.Cmp(least) < 0 {
					t.Fatalf("%d transactions bought %s wei, want an approve and a swap buying at least %s", sent, bought, least)
				}
				t.Logf("%s USDC bought %s ether at a Chainlink price of %s USD: at least %s", usd(in), ether(bought),
					new(big.Rat).SetFrac(price, big.NewInt(1e8)).FloatString(2), ether(least))
				if err := checkGas(ctx, client, c.id, s.sender, GasAlertSettlements); err != nil {
					t.Fatalf("after the swap: %v", err)
				}
			})

			t.Run("a pool below the Chainlink price less 1% is refused and alerts", func(t *testing.T) {
				drain()
				price, err := chain.EthPrice(ctx, client, c.id)
				if err != nil {
					t.Fatal(err)
				}
				// The feed says ether costs a tenth of what the pool pays: no swap clears its floor.
				mock := a.PriceFeed(new(big.Int).Div(price, big.NewInt(10)))
				code, err := client.CodeAt(ctx, mock, nil)
				if err != nil {
					t.Fatal(err)
				}
				if err := a.RPC.Call(nil, "anvil_setCode", chain.EthUSD[c.id].Address, hexutil.Encode(code)); err != nil {
					t.Fatal(err)
				}
				usdcBefore, etherBefore := usdcHeld(), etherHeld()
				logs := run()
				if !strings.Contains(logs, "ALERT executor gas runs low") || !strings.Contains(logs, "no ether bought") ||
					strings.Contains(logs, "executor bought ether for gas") {
					t.Fatal("want the low gas alert naming the refused swap")
				}
				if usdcHeld().Cmp(usdcBefore) != 0 || etherHeld().Cmp(etherBefore) > 0 {
					t.Fatal("a refused swap moved USDC or bought ether")
				}
				// The next round swaps the approve it left, so a pool that keeps refusing costs no more gas.
				drain()
				before, err := client.BlockNumber(ctx)
				if err != nil {
					t.Fatal(err)
				}
				if logs := run(); !strings.Contains(logs, "no ether bought") {
					t.Fatal("want the alert again")
				}
				if after, err := client.BlockNumber(ctx); err != nil || after != before {
					t.Fatalf("a second refused round sent a transaction: block %d to %d, %v", before, after, err)
				}
			})
		})
	}
}
