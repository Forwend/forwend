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
