package address_test

import (
	"context"
	"testing"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

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
	if err := address.FactoryDeployed(ctx, chaintest.ChainID, client); err != nil {
		t.Fatalf("factory deployed: %v", err)
	}
	if err := address.FactoryDeployed(ctx, chaintest.ChainID, failing); err == nil {
		t.Fatal("no error when the chain can't be read")
	}
}
