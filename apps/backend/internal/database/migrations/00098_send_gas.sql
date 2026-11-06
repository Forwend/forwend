-- A send on a chain without sponsorship pays its own gas (R-216, D-119): the token that is its chain's gas coin can
-- pay it from the same balance, as Arc's USDC does.

-- +goose Up
ALTER TABLE tokens ADD COLUMN native_gas boolean NOT NULL DEFAULT false;
UPDATE tokens SET native_gas = true WHERE chain_id = 5042002 AND contract = '0x3600000000000000000000000000000000000000';

-- What the browser signs with when the wallet pays: the fee shown is the most it can cost.
ALTER TABLE sends ADD COLUMN network_fee uint256 NOT NULL DEFAULT 0;
ALTER TABLE sends ADD COLUMN gas_limit bigint CHECK (gas_limit > 0);
ALTER TABLE sends ADD COLUMN max_fee_per_gas uint256;
ALTER TABLE sends ADD COLUMN max_priority_fee_per_gas uint256;
ALTER TABLE sends ADD CONSTRAINT sends_gas CHECK ((gas_limit IS NULL) = (max_fee_per_gas IS NULL)
    AND (gas_limit IS NULL) = (max_priority_fee_per_gas IS NULL) AND ((gas_limit IS NULL) = (network_fee = 0)));

-- +goose Down
ALTER TABLE sends DROP CONSTRAINT sends_gas;
ALTER TABLE sends DROP COLUMN max_priority_fee_per_gas;
ALTER TABLE sends DROP COLUMN max_fee_per_gas;
ALTER TABLE sends DROP COLUMN gas_limit;
ALTER TABLE sends DROP COLUMN network_fee;
ALTER TABLE tokens DROP COLUMN native_gas;
