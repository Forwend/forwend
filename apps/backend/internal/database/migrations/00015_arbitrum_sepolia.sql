-- Arbitrum Sepolia and its USDC (D-38), added switched off. A database turns a chain on by hand once its executor has
-- gas there, because every enabled chain must pass the startup checks (docs/backend/architecture.md#startup).

-- +goose Up
INSERT INTO chains (chain_id, chain_family, name) VALUES (421614, 'evm', 'arbitrum-sepolia') ON CONFLICT DO NOTHING;
INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
VALUES (421614, 'evm', '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d', 'USDC', 6) ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM tokens WHERE chain_id = 421614 AND contract = '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d';
DELETE FROM chains WHERE chain_id = 421614;
