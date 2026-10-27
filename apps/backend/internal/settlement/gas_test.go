package settlement

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

// One wei short of one deploy and settle is refused, naming the chain, the executor and its balance in whole coins.
func TestCheckGas(t *testing.T) {
	ctx := context.Background()
	a := chaintest.Start(t)
	client := ethclient.NewClient(a.RPC)
	executor := common.HexToAddress("0x2222222222222222222222222222222222222222")
	_, feeCap, err := fees(ctx, client, chaintest.ChainID)
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
			_, feeCap, err := fees(ctx, client, chaintest.ChainID)
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
		})
	}
}
