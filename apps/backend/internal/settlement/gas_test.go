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

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5"
)

// One wei short of one deploy and settle is refused, naming the chain, the executor and its balance in whole coins.
func TestCheckGas(t *testing.T) {
	ctx := context.Background()
	a := chaintest.Start(t)
	client := ethclient.NewClient(a.RPC)
	executor := common.HexToAddress("0x2222222222222222222222222222222222222222")
	_, feeCap, err := Fees(ctx, client, chaintest.ChainID)
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

	short := new(big.Int).Sub(need, big.NewInt(1))
	fund(short)
	err = CheckGas(ctx, chaintest.ChainID, executor, client)
	if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("chain %d: executor %s holds %s of the native coin",
		chaintest.ChainID, executor.Hex(), ether(short))) {
		t.Fatalf("one wei short: got %v", err)
	}
	t.Log(err)
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
	if err := CheckGas(ctx, chaintest.ChainID, executor, client, lagging); err == nil || !strings.Contains(err.Error(), "fund it") {
		t.Fatalf("short on the first RPC, rich on a lagging second: %v, want the shortfall", err)
	}
	fund(need)
	if err := CheckGas(ctx, chaintest.ChainID, executor, client); err != nil {
		t.Fatalf("funded: %v", err)
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
			setCode(tempoFeeManager, append(append([]byte{0x73}, c.chosen.Bytes()...), 0x60, 0, 0x52, 0x60, 32, 0x60, 0, 0xf3))
			// Set in storage: a mint would mine a block and move the base fee.
			hold := func(units *big.Int) {
				t.Helper()
				slot := crypto.Keccak256Hash(common.LeftPadBytes(executor.Bytes(), 32), make([]byte, 32)) // _balances, slot 0
				if err := a.RPC.Call(nil, "anvil_setStorageAt", c.pays, slot, common.BigToHash(units)); err != nil {
					t.Fatal(err)
				}
			}
			_, feeCap, err := Fees(ctx, client, chaintest.ChainID)
			if err != nil {
				t.Fatal(err)
			}
			attodollars := new(big.Int).Mul(feeCap, big.NewInt(TempoMinGas))
			need := new(big.Int).Div(new(big.Int).Add(attodollars, big.NewInt(1e12-1)), big.NewInt(1e12))
			short := new(big.Int).Sub(need, big.NewInt(1))
			hold(short)
			err = CheckGas(ctx, chaintest.ChainID, executor, client)
			if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("holds %s of fee token %s", usd(short), c.pays.Hex())) {
				t.Fatalf("one unit short: got %v", err)
			}
			t.Log(err)
			hold(need)
			if err := CheckGas(ctx, chaintest.ChainID, executor, client); err != nil {
				t.Fatalf("funded, with no native coin: %v", err)
			}
			// Enough for one settle is short of the alert's GasAlertSettlements.
			if err := checkGas(ctx, client, chaintest.ChainID, executor, GasAlertSettlements); !errors.Is(err, errFundIt) ||
				!strings.Contains(err.Error(), "20 deploys and settles") {
				t.Fatalf("one settle's fee token against the alert's 20: %v", err)
			}
		})
	}
}

// A provider that suggests a huge tip, wrongly or to drain the executor, can't push a fee over the chain's ceiling.
func TestFeesNeverExceedTheChainCeiling(t *testing.T) {
	ctx := context.Background()
	a := chaintest.Start(t)
	greedy := a.Proxy()
	greedy.Stale(func(c chaintest.Call) json.RawMessage {
		if c.Method == "eth_maxPriorityFeePerGas" {
			return json.RawMessage(`"0x38d7ea4c68000"`) // 1,000,000 gwei
		}
		return nil
	})
	client, err := ethclient.Dial(greedy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	tip, feeCap, err := Fees(ctx, client, chaintest.ChainID)
	ceiling := maxFeePerGas[chaintest.ChainID]
	if err != nil || feeCap.Cmp(ceiling) != 0 || tip.Cmp(feeCap) > 0 {
		t.Fatalf("tip %v, fee cap %v (%v); want both at most the %v ceiling", tip, feeCap, err, ceiling)
	}
	if _, _, err := Fees(ctx, ethclient.NewClient(a.RPC), 999); err == nil || !strings.Contains(err.Error(), "no fee ceiling") {
		t.Fatalf("a chain without a ceiling: %v, want refused", err)
	}
}

// Enough for one settle but not for GasAlertSettlements alerts, long before the signer can't pay.
func TestSignerAlertsWhenExecutorGasRunsLow(t *testing.T) {
	e := setup(t)
	s := e.signer(t)
	_, feeCap, err := Fees(t.Context(), e.client, e.chainID)
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

func TestEveryChainHasAFeeCeiling(t *testing.T) {
	ctx := t.Context()
	pool, err := database.Open(ctx, databasetest.Migrated(t, database.Migrate))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	rows, err := pool.Query(ctx, `SELECT chain_id FROM chains`)
	if err != nil {
		t.Fatal(err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		if maxFeePerGas[uint64(id)] == nil {
			t.Errorf("chain %d has no fee ceiling: switched on, it would not be served", id)
		}
	}
}

// At 2,000 USD an ether: one ether costs 2,000 USDC and must buy at least 0.99 ether; a wei costs a whole USDC unit;
// short of USDC, all of it buys what it can.
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

// Where the signer buys its gas, a buy that fails still alerts and names why: this Anvil has Base's id, not its feed.
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
	_, feeCap, err := Fees(ctx, client, 8453)
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
}

// Dust anyone can send to the executor buys less gas than a swap costs, so it is never approved: an approve of it would
// cap every later swap at the dust. This Anvil has Base's id, a stand-in USDC and a stand-in ETH/USD feed.
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
	setCode(chain.EthUSD[8453], a.PriceFeed(big.NewInt(2000e8)))
	setCode(route.usdc, common.HexToAddress(a.DeployToken()))
	slot := crypto.Keccak256Hash(common.LeftPadBytes(s.sender.Bytes(), 32), make([]byte, 32)) // _balances, slot 0
	if err := a.RPC.Call(nil, "anvil_setStorageAt", route.usdc, slot, common.BigToHash(big.NewInt(100))); err != nil {
		t.Fatal(err)
	}
	_, feeCap, err := Fees(ctx, client, 8453)
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
}
