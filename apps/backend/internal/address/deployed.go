package address

import (
	"context"
	"fmt"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// FactoryDeployed refuses a chain without the factory: invoices there would pay addresses no one can settle. It asks
// the clients in turn, since one can fail with an error that is not an outage (Infura's "Internal error"); when none
// answers, the error is chain.ErrUnavailable.
func FactoryDeployed(ctx context.Context, chainID uint64, clients ...*ethclient.Client) error {
	var err error
	for _, client := range clients {
		var code []byte
		if code, err = client.CodeAt(ctx, common.Address(Factory), nil); err != nil {
			continue
		}
		if len(code) == 0 {
			return fmt.Errorf("chain %d: no factory at %s", chainID, common.Address(Factory).Hex())
		}
		return nil
	}
	return fmt.Errorf("chain %d: read the factory: %w: %w", chainID, err, chain.ErrUnavailable)
}
