package settlement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
)

func TestCheckGas(t *testing.T) {
	ctx := context.Background()
	a := chaintest.Start(t)
	client := ethclient.NewClient(a.RPC)
	executor := common.HexToAddress("0x2222222222222222222222222222222222222222")
	_, feeCap, err := chain.Fees(ctx, client, chaintest.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	need := new(big.Int).Mul(feeCap, big.NewInt(MinGas))
	fund := func(wei *big.Int) {
		t.Helper()
		if err := a.RPC.Call(nil, "anvil_setBalance", executor, hexutil.EncodeBig(wei)); err != nil {
			t.Fatal(err)
		}
	}

	var logs strings.Builder
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	short := new(big.Int).Sub(need, big.NewInt(1))
	fund(short)
	err = CheckGas(ctx, chaintest.ChainID, executor, client)
	if err != nil || !strings.Contains(logs.String(), "ALERT executor gas runs low") ||
		!strings.Contains(logs.String(), fmt.Sprintf("chain %d: executor %s holds %s of the native coin",
			chaintest.ChainID, executor.Hex(), ether(short))) {
		t.Fatalf("one wei short: %v, logs %s; want a start and an alert naming the shortfall", err, logs.String())
	}
	t.Log(logs.String())
	rich := a.Proxy()
	rich.Stale(func(c chaintest.Call) json.RawMessage {
		if c.Method == "eth_getBalance" {
			return json.RawMessage(`"0xde0b6b3a7640000"`) // 1 coin
		}
		return nil
	})
	lagging, err := ethclient.Dial(rich.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer lagging.Close()
	logs.Reset()
	if err := CheckGas(ctx, chaintest.ChainID, executor, client, lagging); err != nil || !strings.Contains(logs.String(), "fund it") {
		t.Fatalf("short on the first RPC, rich on a lagging second: %v, logs %s; want the shortfall alerted", err, logs.String())
	}
	fund(need)
	logs.Reset()
	if err := CheckGas(ctx, chaintest.ChainID, executor, client); err != nil || logs.Len() > 0 {
		t.Fatalf("funded: %v, logs %s", err, logs.String())
	}
	broken := a.Proxy()
	broken.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.InternalError })
	failing, err := ethclient.Dial(broken.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer failing.Close()
	if err := CheckGas(ctx, chaintest.ChainID, executor, failing, client); err != nil {
		t.Fatalf("first RPC failing, second answering: %v", err)
	}
	if err := CheckGas(ctx, chaintest.ChainID, executor, failing, failing); err == nil {
		t.Fatal("no error when no RPC answers")
	}

	for wei, want := range map[int64]string{0: "0", 1: "0.000000000000000001", 1_500_000_000_000_000_000: "1.5"} {
		if got := ether(big.NewInt(wei)); got != want {
			t.Fatalf("ether(%d) = %s, want %s", wei, got, want)
		}
	}
}

func TestCheckGasInFeeToken(t *testing.T) {
	ctx := context.Background()
	a := chaintest.Start(t)
	client := ethclient.NewClient(a.RPC)
	executor := common.HexToAddress("0x2222222222222222222222222222222222222222")
	setCode := func(at common.Address, code []byte) {
		t.Helper()
		if err := a.RPC.Call(nil, "anvil_setCode", at, hexutil.Encode(code)); err != nil {
			t.Fatal(err)
		}
	}
	mock := common.HexToAddress(a.DeployToken())
	tokenCode, err := client.CodeAt(ctx, mock, nil)
	if err != nil {
		t.Fatal(err)
	}
	setCode(pathUSD, tokenCode)

	for _, c := range []struct {
		name   string
		chosen common.Address // what the fee manager answers; zero: no choice
		pays   common.Address
	}{
		{"chosen token", mock, mock},
		{"PathUSD when none is chosen", common.Address{}, pathUSD},
	} {
		t.Run(c.name, func(t *testing.T) {
			// PUSH20 chosen, PUSH1 0, MSTORE, PUSH1 32, PUSH1 0, RETURN: every call answers the chosen token.
			setCode(chain.TempoFeeManager, append(append([]byte{0x73}, c.chosen.Bytes()...), 0x60, 0, 0x52, 0x60, 32, 0x60, 0, 0xf3))
			// Set in storage: a mint would mine a block and move the base fee.
			hold := func(units *big.Int) {
				t.Helper()
				slot := crypto.Keccak256Hash(common.LeftPadBytes(executor.Bytes(), 32), make([]byte, 32)) // _balances, slot 0
				if err := a.RPC.Call(nil, "anvil_setStorageAt", c.pays, slot, common.BigToHash(units)); err != nil {
					t.Fatal(err)
				}
			}
			_, feeCap, err := chain.Fees(ctx, client, chaintest.ChainID)
			if err != nil {
				t.Fatal(err)
			}
			attodollars := new(big.Int).Mul(feeCap, big.NewInt(TempoMinGas))
			need := new(big.Int).Div(new(big.Int).Add(attodollars, big.NewInt(1e12-1)), big.NewInt(1e12))
			short := new(big.Int).Sub(need, big.NewInt(1))
			hold(short)
			err = checkGas(ctx, client, chaintest.ChainID, executor, 1)
			if !errors.Is(err, errFundIt) || !strings.Contains(err.Error(), fmt.Sprintf("holds %s of fee token %s", usd(short), c.pays.Hex())) {
				t.Fatalf("one unit short: got %v", err)
			}
			t.Log(err)
			hold(need)
			if err := CheckGas(ctx, chaintest.ChainID, executor, client); err != nil {
				t.Fatalf("funded, with no native coin: %v", err)
			}
			if err := checkGas(ctx, client, chaintest.ChainID, executor, GasAlertSettlements); !errors.Is(err, errFundIt) ||
				!strings.Contains(err.Error(), "20 deploys and settles") {
				t.Fatalf("one settle's fee token against the alert's 20: %v", err)
			}
		})
	}
}

func TestSignerAlertsWhenExecutorGasRunsLow(t *testing.T) {
	e := setup(t)
	s := e.signer(t)
	_, feeCap, err := chain.Fees(t.Context(), e.client, e.chainID)
	if err != nil {
		t.Fatal(err)
	}
	low := new(big.Int).Mul(feeCap, big.NewInt(MinGas*2))
	if err := e.anvil.RPC.Call(nil, "anvil_setBalance", s.sender, hexutil.EncodeBig(low)); err != nil {
		t.Fatal(err)
	}
	var logs strings.Builder
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	if err := s.Run(t.Context()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(logs.String(), "ALERT executor gas runs low") || !strings.Contains(logs.String(), "20 deploys and settles") {
		t.Fatalf("logs lack the low gas alert:\n%s", logs.String())
	}
	if err := s.Run(t.Context()); err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(logs.String(), "ALERT executor gas runs low"); n != 1 {
		t.Fatalf("%d gas alerts in two rounds; want one per GasCheckEvery", n)
	}
}

func TestSwapAmounts(t *testing.T) {
	price := big.NewInt(2000e8)
	for _, c := range []struct {
		wei, held, in, least string
	}{
		{"1000000000000000000", "5000000000", "2000000000", "990000000000000000"},
		{"1", "5000000000", "1", "495000000"},
		{"1000000000000000000", "1000000", "1000000", "495000000000000"},
		{"1000000000000000000", "0", "0", "0"},
	} {
		wei, _ := new(big.Int).SetString(c.wei, 10)
		held, _ := new(big.Int).SetString(c.held, 10)
		in, least := swapAmounts(wei, held, price)
		if in.String() != c.in || least.String() != c.least {
			t.Errorf("%s wei with %s USDC units: in %s, least %s; want %s, %s", c.wei, c.held, in, least, c.in, c.least)
		}
	}
}

func TestSignerAlertsWhenItCantBuyGas(t *testing.T) {
	ctx := t.Context()
	pool, err := database.Open(ctx, databasetest.Migrated(t, database.Migrate))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	a := chaintest.StartChain(t, 8453)
	client := ethclient.NewClient(a.RPC)
	key, err := crypto.HexToECDSA(strings.TrimPrefix(chaintest.Key, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	s := NewSigner(pool, key, map[uint64]*ethclient.Client{8453: client})
	_, feeCap, err := chain.Fees(ctx, client, 8453)
	if err != nil {
		t.Fatal(err)
	}
	low := new(big.Int).Mul(feeCap, big.NewInt(MinGas*2))
	if err := a.RPC.Call(nil, "anvil_setBalance", s.sender, hexutil.EncodeBig(low)); err != nil {
		t.Fatal(err)
	}
	var logs strings.Builder
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(logs.String(), "ALERT executor gas runs low") ||
		!strings.Contains(logs.String(), "no ether bought: chain 8453 ETH/USD feed answered 0 bytes") {
		t.Fatalf("logs lack the low gas alert with the failed buy:\n%s", logs.String())
	}

	before, err := client.NonceAt(ctx, s.sender, nil)
	if err != nil {
		t.Fatal(err)
	}
	ago := func(d time.Duration) int64 { return time.Now().Add(-d).Unix() }
	for _, c := range []struct {
		name          string
		updated, down int64
		says          string
	}{
		{"stale", ago(time.Hour), 0, "ETH/USD feed last answered"},
		{"sequencer down", 0, 1, "sequencer is down"},
	} {
		a.Feed(chain.EthUSD[8453].Address, big.NewInt(2000e8), ago(2*time.Hour), c.updated)
		a.Feed(chain.SequencerUptime[8453], big.NewInt(c.down), ago(24*time.Hour), 0)
		logs.Reset()
		s.gasCheckedAt = time.Time{}
		if err := s.Run(ctx); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(logs.String(), "ALERT executor gas runs low") || !strings.Contains(logs.String(), c.says) {
			t.Fatalf("%s: logs lack the low gas alert naming %q:\n%s", c.name, c.says, logs.String())
		}
	}
	if after, err := client.NonceAt(ctx, s.sender, nil); err != nil || after != before {
		t.Fatalf("a refused price sent %d transactions (%v), want none", after-before, err)
	}
}

func TestSignerSwapsNoDust(t *testing.T) {
	ctx := t.Context()
	pool, err := database.Open(ctx, databasetest.Migrated(t, database.Migrate))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	a := chaintest.StartChain(t, 8453)
	client := ethclient.NewClient(a.RPC)
	key, err := crypto.HexToECDSA(strings.TrimPrefix(chaintest.Key, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	s := NewSigner(pool, key, map[uint64]*ethclient.Client{8453: client})
	setCode := func(at common.Address, from common.Address) {
		t.Helper()
		code, err := client.CodeAt(ctx, from, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := a.RPC.Call(nil, "anvil_setCode", at, hexutil.Encode(code)); err != nil {
			t.Fatal(err)
		}
	}
	route := swapRoutes[8453]
	setCode(chain.EthUSD[8453].Address, a.PriceFeed(big.NewInt(2000e8)))
	// The sequencer has been up for a day.
	a.Feed(chain.SequencerUptime[8453], new(big.Int), time.Now().Add(-24*time.Hour).Unix(), 0)
	setCode(route.usdc, common.HexToAddress(a.DeployToken()))
	slot := crypto.Keccak256Hash(common.LeftPadBytes(s.sender.Bytes(), 32), make([]byte, 32)) // _balances, slot 0
	if err := a.RPC.Call(nil, "anvil_setStorageAt", route.usdc, slot, common.BigToHash(big.NewInt(100))); err != nil {
		t.Fatal(err)
	}
	_, feeCap, err := chain.Fees(ctx, client, 8453)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.RPC.Call(nil, "anvil_setBalance", s.sender, hexutil.EncodeBig(new(big.Int).Mul(feeCap, big.NewInt(MinGas*2)))); err != nil {
		t.Fatal(err)
	}
	before, err := client.NonceAt(ctx, s.sender, nil)
	if err != nil {
		t.Fatal(err)
	}
	var logs strings.Builder
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	if after, err := client.NonceAt(ctx, s.sender, nil); err != nil || after != before {
		t.Fatalf("dust sent %d transactions (%v), want none", after-before, err)
	}
	if !strings.Contains(logs.String(), "ALERT executor gas runs low") ||
		!strings.Contains(logs.String(), "no ether bought: 0.0001 USDC to swap buys less than one deploy and settle") {
		t.Fatalf("logs lack the low gas alert naming the dust:\n%s", logs.String())
	}

	a.Send(route.usdc.Hex(), "approve(address,uint256)", route.router.Hex(), "50")
	if err := a.RPC.Call(nil, "anvil_setStorageAt", route.usdc, slot, common.BigToHash(big.NewInt(100_000000))); err != nil {
		t.Fatal(err)
	}
	_, feeCap, err = chain.Fees(ctx, client, 8453)
	if err != nil {
		t.Fatal(err)
	}
	low := new(big.Int).Mul(feeCap, big.NewInt(MinGas*2))
	if err := a.RPC.Call(nil, "anvil_setBalance", s.sender, hexutil.EncodeBig(low)); err != nil {
		t.Fatal(err)
	}
	in, _ := swapAmounts(new(big.Int).Sub(new(big.Int).Mul(feeCap, big.NewInt(MinGas*topUpSettlements)), low),
		big.NewInt(100_000000), big.NewInt(2000e8))
	s.gasCheckedAt = time.Time{}
	if err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	allowance, err := client.CallContract(ctx, ethereum.CallMsg{To: &route.usdc, Data: append(append(
		selector("allowance(address,address)"), common.LeftPadBytes(s.sender.Bytes(), 32)...),
		common.LeftPadBytes(route.router.Bytes(), 32)...)}, nil)
	if err != nil || new(big.Int).SetBytes(allowance).Cmp(in) != 0 {
		t.Fatalf("allowance %x (%v), want this swap's %s USDC units approved in place of the 50 left", allowance, err, in)
	}
}
