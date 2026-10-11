-- Arc testnet and its USDC (D-38), added switched off like 00015. Arc pays gas in USDC; 0x3600… is its ERC-20
-- interface, with 6 decimals.

-- +goose Up
INSERT INTO chains (chain_id, chain_family, name) VALUES (5042002, 'evm', 'arc-testnet') ON CONFLICT DO NOTHING;
INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
VALUES (5042002, 'evm', '0x3600000000000000000000000000000000000000', 'USDC', 6) ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM tokens WHERE chain_id = 5042002 AND contract = '0x3600000000000000000000000000000000000000';
DELETE FROM chains WHERE chain_id = 5042002;
