-- What a send's wallet really paid for gas, in the token's base units, read from its receipt once it is sent or
-- reverted (R-224): 0 where Forwend pays, NULL until known. Tempo's mainnet OUSD pays its own fee from the same balance,
-- as Arc's USDC does (00098); the testnets keep their sponsorship.

-- +goose Up
ALTER TABLE sends ADD COLUMN fee_paid uint256;
UPDATE tokens SET native_gas = true WHERE chain_id = 4217 AND contract = '0x20c0000000000000000000006a37da5c996874be';

-- +goose Down
UPDATE tokens SET native_gas = false WHERE chain_id = 4217 AND contract = '0x20c0000000000000000000006a37da5c996874be';
ALTER TABLE sends DROP COLUMN fee_paid;
