package address_test

import (
	"context"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ethereum/go-ethereum/ethclient"
)

// The factory check refuses a chain without the factory. A client that fails with an error, as Infura answered
// eth_getCode on 2026-10-22, gives way to the next; when none answers, the check fails.
func TestFactoryDeployed(t *testing.T) {
	ctx := context.Background()
	a := chaintest.Start(t)
	client := ethclient.NewClient(a.RPC)
	broken := a.Proxy()
	broken.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.InternalError })
	failing, err := ethclient.Dial(broken.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer failing.Close()

	if err := address.FactoryDeployed(ctx, chaintest.ChainID, client); err == nil {
		t.Fatal("no error on a chain without the factory")
	}
	a.DeployFactory()
	if err := address.FactoryDeployed(ctx, chaintest.ChainID, failing, client); err != nil {
		t.Fatalf("primary failing, second answering: %v", err)
	}
	if err := address.FactoryDeployed(ctx, chaintest.ChainID, failing, failing); err == nil {
		t.Fatal("no error when no client answers")
	}
}
