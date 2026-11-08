-- Every send pays its own network fee (D-121). fee_asset names the Privy user-pays asset a token's send pays its fee in,
-- through Privy's paymaster: USDC on Base and Arbitrum, testnets too. Tempo Moderato's OUSD pays its own fee from the
-- same balance, as Tempo's mainnet OUSD does (00108). Nothing is sponsored any more, so gas_sponsored goes. A send keeps
-- its fee asset, and the Privy transaction that carries it until the hash is known.

-- +goose Up
ALTER TABLE tokens ADD COLUMN fee_asset text CHECK (fee_asset ~ '^[a-z_]+$');
ALTER TABLE tokens ADD CHECK (NOT (native_gas AND fee_asset IS NOT NULL));
UPDATE tokens SET fee_asset = 'usdc' WHERE (chain_id, contract) IN (
    (84532, '0x036cbd53842c5426634e7929541ec2318f3dcf7e'), (421614, '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d'),
    (8453, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'), (42161, '0xaf88d065e77c8cc2239327c5edb3a432268e5831'));
UPDATE tokens SET native_gas = true WHERE chain_id = 42431 AND contract = '0x20c0000000000000000000006a37da5c996874be';
ALTER TABLE chains DROP COLUMN gas_sponsored;
ALTER TABLE sends ADD COLUMN fee_asset text, ADD COLUMN privy_transaction_id text UNIQUE;
-- Gas caps are a wallet-paid send's; a paymaster send has an estimated fee and none. Neither is a send sponsored before.
ALTER TABLE sends DROP CONSTRAINT sends_gas;
ALTER TABLE sends ADD CONSTRAINT sends_gas CHECK ((gas_limit IS NULL) = (max_fee_per_gas IS NULL)
    AND (gas_limit IS NULL) = (max_priority_fee_per_gas IS NULL)
    AND (gas_limit IS NOT NULL) = (fee_asset IS NULL AND network_fee > 0) AND (fee_asset IS NULL OR network_fee > 0));
-- A relayed send is submitted before Privy or the chain gives its hash.
ALTER TABLE sends DROP CONSTRAINT sends_check1, DROP CONSTRAINT sends_check2;
ALTER TABLE sends ADD CONSTRAINT sends_submitted CHECK ((submitted_at IS NULL) = (tx_hash IS NULL AND privy_transaction_id IS NULL)),
    ADD CONSTRAINT sends_hash CHECK (status NOT IN ('submitted', 'sent') OR tx_hash IS NOT NULL
        OR status = 'submitted' AND privy_transaction_id IS NOT NULL);

-- +goose Down
DELETE FROM sends WHERE fee_asset IS NOT NULL;
ALTER TABLE sends DROP CONSTRAINT sends_submitted, DROP CONSTRAINT sends_hash;
ALTER TABLE sends ADD CONSTRAINT sends_check1 CHECK ((tx_hash IS NULL) = (submitted_at IS NULL)),
    ADD CONSTRAINT sends_check2 CHECK (status NOT IN ('submitted', 'sent') OR tx_hash IS NOT NULL);
ALTER TABLE sends DROP CONSTRAINT sends_gas;
ALTER TABLE sends ADD CONSTRAINT sends_gas CHECK ((gas_limit IS NULL) = (max_fee_per_gas IS NULL)
    AND (gas_limit IS NULL) = (max_priority_fee_per_gas IS NULL) AND ((gas_limit IS NULL) = (network_fee = 0)));
ALTER TABLE sends DROP COLUMN privy_transaction_id, DROP COLUMN fee_asset;
ALTER TABLE chains ADD COLUMN gas_sponsored boolean NOT NULL DEFAULT false;
UPDATE chains SET gas_sponsored = true WHERE chain_id IN (84532, 421614, 42431);
UPDATE tokens SET native_gas = false WHERE chain_id = 42431 AND contract = '0x20c0000000000000000000006a37da5c996874be';
ALTER TABLE tokens DROP COLUMN fee_asset;
