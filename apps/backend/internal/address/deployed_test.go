package address_test

import (
	"context"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ethereum/go-ethereum/ethclient"
)

func TestFactoryDeployed(t *testing.T) {
	a := chaintest.Start(t)
	client := ethclient.NewClient(a.RPC)
	if err := address.FactoryDeployed(context.Background(), client, chaintest.ChainID); err == nil {
		t.Fatal("no error on a chain without the factory")
	}
	a.DeployFactory()
	if err := address.FactoryDeployed(context.Background(), client, chaintest.ChainID); err != nil {
		t.Fatal(err)
	}
}
