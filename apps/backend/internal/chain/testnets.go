package chain

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

func EnableTestnetTokens(ctx context.Context, db *pgxpool.Pool) error {
	_, err := db.Exec(ctx, `
		WITH defaults (chain_id, name, contract, symbol, native_gas, fee_asset) AS (
		    VALUES (84532::bigint, 'base-sepolia', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 'USDC', false, 'usdc'),
		           (421614, 'arbitrum-sepolia', '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d', 'USDC', false, 'usdc'),
		           (5042002, 'arc-testnet', '0x3600000000000000000000000000000000000000', 'USDC', true, NULL),
		           (42431, 'tempo-moderato', '0x20c0000000000000000000006a37da5c996874be', 'OUSD', true, NULL)
		), enabled AS (
		    INSERT INTO chains (chain_id, chain_family, name, enabled)
		    SELECT chain_id, 'evm', name, true FROM defaults
		    ON CONFLICT (chain_id) DO UPDATE SET enabled = true
		    RETURNING chain_id
		)
		INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled, native_gas, fee_asset)
		SELECT d.chain_id, 'evm', d.contract, d.symbol, 6, true, d.native_gas, d.fee_asset
		FROM defaults d JOIN enabled e ON e.chain_id = d.chain_id
		ON CONFLICT (chain_id, contract) DO UPDATE SET enabled = true`)
	if err != nil {
		return fmt.Errorf("enable testnet pairs: %w", err)
	}
	return nil
}
