-- Sends out of a profile wallet (R-211, R-212, D-119): the server checks each one before the browser signs it, then
-- follows it to the chain through wallet_transfers.

-- +goose Up
-- Privy pays the gas on these chains (Privy dashboard > Gas sponsorship). Only they offer Send.
ALTER TABLE chains ADD COLUMN gas_sponsored boolean NOT NULL DEFAULT false;
UPDATE chains SET gas_sponsored = true WHERE chain_id IN (84532, 421614, 42431);

CREATE TABLE sends (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles (id),
    chain_id bigint NOT NULL,
    chain_family text NOT NULL,
    token_contract text NOT NULL,
    from_address text NOT NULL,
    to_address text NOT NULL,
    -- Set for a transfer to another of the owner's profiles.
    to_profile_id uuid REFERENCES profiles (id),
    amount uint256 NOT NULL CHECK (amount > 0),
    status text NOT NULL DEFAULT 'prepared'
        CHECK (status IN ('prepared', 'submitted', 'sent', 'failed', 'canceled', 'expired')),
    tx_hash text,
    failure text CHECK (failure IN ('reverted', 'dropped')),
    created_at timestamptz NOT NULL DEFAULT now(),
    submitted_at timestamptz,
    finished_at timestamptz,
    FOREIGN KEY (chain_id, chain_family) REFERENCES chains (chain_id, chain_family),
    FOREIGN KEY (chain_id, token_contract) REFERENCES tokens (chain_id, contract),
    FOREIGN KEY (chain_family, from_address) REFERENCES profile_wallets (chain_family, address),
    CHECK (chain_family <> 'evm' OR (to_address ~ '^0x[0-9a-f]{40}$' AND tx_hash ~ '^0x[0-9a-f]{64}$')),
    CHECK ((tx_hash IS NULL) = (submitted_at IS NULL)),
    CHECK (status NOT IN ('submitted', 'sent') OR tx_hash IS NOT NULL),
    CHECK ((status = 'failed') = (failure IS NOT NULL))
);
-- One unsigned send per wallet and chain (R-211). Signed ones are never refused here: a hash is never lost.
CREATE UNIQUE INDEX sends_one_unsigned ON sends (from_address, chain_id) WHERE status = 'prepared';
-- A hash belongs to one send, so one transfer can't mark two sends sent.
CREATE UNIQUE INDEX sends_tx ON sends (chain_id, tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX sends_profile ON sends (profile_id, created_at);

-- +goose Down
DROP TABLE sends;
ALTER TABLE chains DROP COLUMN gas_sponsored;
