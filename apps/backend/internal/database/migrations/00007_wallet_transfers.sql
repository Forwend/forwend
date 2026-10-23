-- Transfer logs of profile wallets (R-38): one row per wallet and direction, so a transfer between two profile
-- wallets is out for one and in for the other. Reorg rules are those of chain_transfers.

-- +goose Up
CREATE TABLE wallet_transfers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chain_id bigint NOT NULL,
    chain_family text NOT NULL,
    token_contract text NOT NULL,
    wallet_address text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('in', 'out')),
    counterparty text NOT NULL,
    tx_hash text NOT NULL,
    log_index bigint NOT NULL CHECK (log_index >= 0),
    block_hash text NOT NULL,
    block_number bigint NOT NULL CHECK (block_number >= 0),
    block_time bigint NOT NULL CHECK (block_time >= 0),
    amount uint256 NOT NULL CHECK (amount > 0),
    status text NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'confirmed', 'reorged')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (chain_id, block_hash, log_index, wallet_address, direction),
    FOREIGN KEY (chain_id, chain_family) REFERENCES chains (chain_id, chain_family),
    FOREIGN KEY (chain_id, token_contract) REFERENCES tokens (chain_id, contract),
    FOREIGN KEY (chain_family, wallet_address) REFERENCES profile_wallets (chain_family, address),
    CHECK (chain_family <> 'evm' OR (tx_hash ~ '^0x[0-9a-f]{64}$' AND block_hash ~ '^0x[0-9a-f]{64}$'
        AND counterparty ~ '^0x[0-9a-f]{40}$'))
);
CREATE UNIQUE INDEX wallet_transfers_live_log ON wallet_transfers (chain_id, tx_hash, log_index, wallet_address, direction)
    WHERE status <> 'reorged';
CREATE INDEX wallet_transfers_wallet ON wallet_transfers (wallet_address, block_time);
-- Every scan reads the detected rows of its chain.
CREATE INDEX wallet_transfers_detected ON wallet_transfers (chain_id, block_number) WHERE status = 'detected';

-- +goose Down
DROP TABLE wallet_transfers;
