-- The mainnets' tokens (R-222), identified by chain and contract. They are enabled; their chains stay off until the
-- owner switches each on. Arc pays gas in its USDC, as on Arc Testnet (00098). Tempo OUSD starts off for profiles,
-- as on Tempo Moderato (R-136).

-- +goose Up
INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled, native_gas) VALUES
(8453, 'evm', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 6, true, false),
(42161, 'evm', '0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'USDC', 6, true, false),
(5042, 'evm', '0x3600000000000000000000000000000000000000', 'USDC', 6, true, true),
(4217, 'evm', '0x20c0000000000000000000006a37da5c996874be', 'OUSD', 6, true, false)
ON CONFLICT (chain_id, contract) DO NOTHING;

INSERT INTO profile_tokens_off (profile_id, chain_id, token_contract)
SELECT id, 4217, '0x20c0000000000000000000006a37da5c996874be' FROM profiles
ON CONFLICT DO NOTHING;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION profile_tempo_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO profile_tokens_off (profile_id, chain_id, token_contract)
    SELECT NEW.id, chain_id, contract FROM tokens
    WHERE chain_id IN (42431, 4217) AND contract = '0x20c0000000000000000000006a37da5c996874be';
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION profile_tempo_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO profile_tokens_off (profile_id, chain_id, token_contract)
    SELECT NEW.id, chain_id, contract FROM tokens
    WHERE chain_id = 42431 AND contract = '0x20c0000000000000000000006a37da5c996874be';
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
DELETE FROM profile_tokens_off WHERE chain_id IN (8453, 42161, 5042, 4217);
DELETE FROM store_tokens_off WHERE chain_id IN (8453, 42161, 5042, 4217);
DELETE FROM tokens WHERE chain_id IN (8453, 42161, 5042, 4217);
