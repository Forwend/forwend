package ledger

import (
	"context"
	"testing"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

func TestBalanceRoundSharesTheSecondProviderHeader(t *testing.T) {
	a := chaintest.Start(t)
	token := a.DeployToken()
	a.Mint(token, "1000000")
	a.Mine(2)
	proxy := a.Proxy()
	client, err := ethclient.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	read := BalanceSnapshot(client)
	ctx := context.Background()
	var first uint64
	for range 10 {
		balance, block, err := read(ctx, chaintest.ChainID, token, chaintest.Sender)
		if err != nil || balance == nil || balance.Int64() != 1000000 {
			t.Fatalf("balance %v (%v)", balance, err)
		}
		first = block
	}
	headers, balances := 0, 0
	for _, call := range proxy.Calls() {
		switch call.Method {
		case "eth_getBlockByNumber":
			headers++
		case "eth_call":
			balances++
		}
	}
	if headers != 1 || balances != 10 {
		t.Fatalf("10 balances used %d headers and %d calls", headers, balances)
	}
	a.Mint(token, "1000000")
	a.Mine(2)
	value, block, err := read(ctx, chaintest.ChainID, token, chaintest.Sender)
	if err != nil || value.Int64() != 1000000 || block != first {
		t.Fatalf("snapshot moved: %v at %d (%v)", value, block, err)
	}
	value, block, err = BalanceSnapshot(client)(ctx, chaintest.ChainID, token, chaintest.Sender)
	if err != nil || value.Int64() != 2000000 || block <= first {
		t.Fatalf("new round did not advance: %v at %d (%v)", value, block, err)
	}
}
