package address_test

import (
	"context"
	"errors"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ethereum/go-ethereum/ethclient"
)

// The factory check refuses a chain without the factory, a mistake that stops startup. A client that fails with an
// error, as Infura answered eth_getCode on 2026-10-22, gives way to the next; when none answers, the chain is
// unavailable, which startup logs and rides out (D-71).
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

	if err := address.FactoryDeployed(ctx, chaintest.ChainID, client); err == nil || errors.Is(err, chain.ErrUnavailable) {
		t.Fatalf("chain without the factory: %v, want a mistake that stops startup", err)
	}
	a.DeployFactory()
	if err := address.FactoryDeployed(ctx, chaintest.ChainID, failing, client); err != nil {
		t.Fatalf("primary failing, second answering: %v", err)
	}
	if err := address.FactoryDeployed(ctx, chaintest.ChainID, failing, failing); !errors.Is(err, chain.ErrUnavailable) {
		t.Fatalf("no client answering: %v, want chain.ErrUnavailable", err)
	}
}
