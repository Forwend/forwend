-- +goose Up
-- dRPC's free plan takes 101-block log ranges and 3-call batches, and answers over them with a misleading error.
DELETE FROM rpc_endpoints WHERE provider = 'drpc';

-- Public endpoints measured on 2026-10-29 (chain ID, finalized tag, log range, batch, block-hash eth_call). The pool
-- ranks them, HTTPS and WSS together, by measured answer time and failures; priority only orders unmeasured ones.
INSERT INTO rpc_endpoints(chain_id, id, provider, role, tier, priority, public_url, budget_group) VALUES
(84532, 'base-publicnode-wss', 'publicnode', 'confirmation', 'public', 10, 'wss://base-sepolia-rpc.publicnode.com', 'publicnode-public'),
(84532, 'base-pocket', 'pocket', 'primary', 'public', 20, 'https://base-testnet.api.pocket.network', 'pocket-public'),
(84532, 'base-tenderly', 'tenderly', 'primary', 'public', 30, 'https://base-sepolia.gateway.tenderly.co', 'tenderly-public'),
(421614, 'arbitrum-publicnode-wss', 'publicnode', 'confirmation', 'public', 10, 'wss://arbitrum-sepolia-rpc.publicnode.com', 'publicnode-public'),
(421614, 'arbitrum-pocket', 'pocket', 'primary', 'public', 20, 'https://arbitrum-sepolia-testnet.api.pocket.network', 'pocket-public'),
(421614, 'arbitrum-tenderly', 'tenderly', 'primary', 'public', 30, 'https://arbitrum-sepolia.gateway.tenderly.co', 'tenderly-public'),
(5042002, 'arc-publicnode', 'publicnode', 'primary', 'public', 10, 'https://arc-testnet-rpc.publicnode.com', 'publicnode-public'),
(5042002, 'arc-publicnode-wss', 'publicnode', 'primary', 'public', 10, 'wss://arc-testnet-rpc.publicnode.com', 'publicnode-public'),
(5042002, 'arc-blockdaemon-wss', 'blockdaemon', 'confirmation', 'public', 20, 'wss://rpc.blockdaemon.testnet.arc.io/websocket', 'blockdaemon-public'),
(5042002, 'arc-official-wss', 'arc', 'confirmation', 'public', 30, 'wss://rpc.testnet.arc.io', 'arc-public'),
(42431, 'tempo-official-wss', 'tempo', 'primary', 'public', 10, 'wss://rpc.moderato.tempo.xyz', 'tempo-public'),
(42431, 'tempo-testnet', 'tempo', 'confirmation', 'public', 20, 'https://rpc.testnet.tempo.xyz', 'tempo-public'),
(42431, 'tempo-testnet-wss', 'tempo', 'confirmation', 'public', 20, 'wss://rpc.testnet.tempo.xyz', 'tempo-public')
ON CONFLICT (chain_id, id) DO NOTHING;

-- +goose Down
DELETE FROM rpc_endpoints WHERE id IN ('base-publicnode-wss', 'base-pocket', 'base-tenderly', 'arbitrum-publicnode-wss',
    'arbitrum-pocket', 'arbitrum-tenderly', 'arc-publicnode', 'arc-publicnode-wss', 'arc-blockdaemon-wss',
    'arc-official-wss', 'tempo-official-wss', 'tempo-testnet', 'tempo-testnet-wss');
INSERT INTO rpc_endpoints(chain_id, id, provider, role, tier, priority, public_url, budget_group) VALUES
(84532, 'base-drpc', 'drpc', 'primary', 'public', 20, 'https://base-sepolia.drpc.org', 'drpc-public'),
(421614, 'arbitrum-drpc', 'drpc', 'primary', 'public', 20, 'https://arbitrum-sepolia.drpc.org', 'drpc-public'),
(5042002, 'arc-drpc', 'drpc', 'primary', 'public', 10, 'https://rpc.drpc.testnet.arc.io', 'drpc-public'),
(42431, 'tempo-drpc', 'drpc', 'confirmation', 'public', 10, 'https://tempo-moderato-testnet.drpc.org', 'drpc-public')
ON CONFLICT (chain_id, id) DO NOTHING;
