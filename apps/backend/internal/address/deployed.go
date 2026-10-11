package address

import (
	"context"
	"fmt"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// FactoryDeployed refuses a chain without the factory: invoices there would pay addresses no one can settle.
func FactoryDeployed(ctx context.Context, client *ethclient.Client, chainID uint64) error {
	code, err := client.CodeAt(ctx, common.Address(Factory), nil)
	if err != nil {
		return fmt.Errorf("chain %d: read the factory: %w", chainID, err)
	}
	if len(code) == 0 {
		return fmt.Errorf("chain %d: no factory at %s", chainID, common.Address(Factory).Hex())
	}
	return nil
}
