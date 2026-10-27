-- +goose Up
ALTER TABLE chains ADD COLUMN rpc_max_head_age_seconds integer NOT NULL DEFAULT 120
    CHECK (rpc_max_head_age_seconds BETWEEN 1 AND 3600);

CREATE TABLE rpc_endpoints (
    chain_id bigint NOT NULL REFERENCES chains(chain_id),
    id text NOT NULL CHECK (id ~ '^[a-z][a-z0-9_-]{0,63}$'),
    provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
    role text NOT NULL CHECK (role IN ('primary', 'confirmation')),
    tier text NOT NULL CHECK (tier IN ('private', 'public')),
    priority integer NOT NULL CHECK (priority >= 0),
    enabled boolean NOT NULL DEFAULT true,
    public_url text,
    secret_ref text CHECK (secret_ref ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    budget_group text NOT NULL CHECK (budget_group ~ '^[a-z][a-z0-9_-]{0,63}$'),
    PRIMARY KEY (chain_id, id),
    CHECK ((tier = 'private' AND secret_ref IS NOT NULL AND public_url IS NULL)
        OR (tier = 'public' AND public_url IS NOT NULL AND secret_ref IS NULL))
);

INSERT INTO chains(chain_id, chain_family, name, enabled)
VALUES (84532, 'evm', 'base-sepolia', false)
ON CONFLICT (chain_id) DO NOTHING;

INSERT INTO rpc_endpoints(chain_id, id, provider, role, tier, priority, public_url, budget_group) VALUES
(84532, 'base-official', 'base', 'primary', 'public', 10, 'https://sepolia.base.org', 'base-public'),
(84532, 'base-publicnode', 'publicnode', 'confirmation', 'public', 10, 'https://base-sepolia-rpc.publicnode.com', 'publicnode-public'),
(84532, 'base-drpc', 'drpc', 'primary', 'public', 20, 'https://base-sepolia.drpc.org', 'drpc-public'),
(421614, 'arbitrum-official', 'arbitrum', 'primary', 'public', 10, 'https://sepolia-rollup.arbitrum.io/rpc', 'arbitrum-public'),
(421614, 'arbitrum-publicnode', 'publicnode', 'confirmation', 'public', 10, 'https://arbitrum-sepolia-rpc.publicnode.com', 'publicnode-public'),
(421614, 'arbitrum-drpc', 'drpc', 'primary', 'public', 20, 'https://arbitrum-sepolia.drpc.org', 'drpc-public'),
(5042002, 'arc-drpc', 'drpc', 'primary', 'public', 10, 'https://rpc.drpc.testnet.arc.io', 'drpc-public'),
(5042002, 'arc-official', 'arc', 'confirmation', 'public', 10, 'https://rpc.testnet.arc.io', 'arc-public'),
(5042002, 'arc-quicknode', 'quicknode', 'primary', 'public', 20, 'https://rpc.quicknode.testnet.arc.io', 'quicknode-public'),
(5042002, 'arc-blockdaemon', 'blockdaemon', 'confirmation', 'public', 20, 'https://rpc.blockdaemon.testnet.arc.io', 'blockdaemon-public'),
(42431, 'tempo-official', 'tempo', 'primary', 'public', 10, 'https://rpc.moderato.tempo.xyz', 'tempo-public'),
(42431, 'tempo-drpc', 'drpc', 'confirmation', 'public', 10, 'https://tempo-moderato-testnet.drpc.org', 'drpc-public');

-- +goose Down
DROP TABLE rpc_endpoints;
ALTER TABLE chains DROP COLUMN rpc_max_head_age_seconds;
