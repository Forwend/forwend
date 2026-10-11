package settlement

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// The signer starts only when the executor can pay one deploy and settle at the current gas price; one wei less is
// refused with the chain, the executor's address and its balance in whole coins.
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
	err = CheckGas(ctx, client, chaintest.ChainID, executor)
	if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("chain %d: executor %s holds %s of the native coin",
		chaintest.ChainID, executor.Hex(), ether(short))) {
		t.Fatalf("one wei short: got %v", err)
	}
	t.Log(err)
	fund(need)
	if err := CheckGas(ctx, client, chaintest.ChainID, executor); err != nil {
		t.Fatalf("funded: %v", err)
	}

	for wei, want := range map[int64]string{0: "0", 1: "0.000000000000000001", 1_500_000_000_000_000_000: "1.5"} {
		if got := ether(big.NewInt(wei)); got != want {
			t.Fatalf("ether(%d) = %s, want %s", wei, got, want)
		}
	}
}

// On Tempo the fee comes out of a TIP-20 token, not the placeholder native balance: the one the executor chose in the
// fee manager, else PathUSD. Anvil stands in with a fee manager that answers one token and a MockToken.
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
			// The balance goes straight into the token's storage: a mint would mine a block and move the base fee.
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
			attodollars := new(big.Int).Mul(feeCap, big.NewInt(MinGas))
			need := new(big.Int).Div(new(big.Int).Add(attodollars, big.NewInt(1e12-1)), big.NewInt(1e12))
			short := new(big.Int).Sub(need, big.NewInt(1))
			hold(short)
			err = CheckGas(ctx, client, chaintest.ChainID, executor)
			if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("holds %s of fee token %s", usd(short), c.pays.Hex())) {
				t.Fatalf("one unit short: got %v", err)
			}
			t.Log(err)
			hold(need)
			if err := CheckGas(ctx, client, chaintest.ChainID, executor); err != nil {
				t.Fatalf("funded, with no native coin: %v", err)
			}
		})
	}
}
