-- Tempo Moderato and OUSD (D-36, D-38), added switched off like 00015. OUSD is a TIP-20 token at the same address on
-- testnet and mainnet (tempo.xyz/developers/docs/guide/ousd).

-- +goose Up
INSERT INTO chains (chain_id, chain_family, name) VALUES (42431, 'evm', 'tempo-moderato') ON CONFLICT DO NOTHING;
INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
VALUES (42431, 'evm', '0x20c0000000000000000000006a37da5c996874be', 'OUSD', 6) ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM tokens WHERE chain_id = 42431 AND contract = '0x20c0000000000000000000006a37da5c996874be';
DELETE FROM chains WHERE chain_id = 42431;
