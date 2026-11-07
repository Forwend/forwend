-- The mainnets, live mode (D-87) and switched off: serving one waits for its tokens, fee ceiling and the owner's
-- switch. Public endpoints from chainlist measured on 2026-11-08 (chain ID, finalized tag, 1000-block logs, 25-call
-- batch, block-hash eth_call). Left out: mainnet.base.org, which refused logs and batches at its rate limit;
-- PublicNode on Arbitrum, which has no state at the finalized block; dRPC (R-185).

-- +goose Up
INSERT INTO chains (chain_id, chain_family, name, enabled, livemode) VALUES
(8453, 'evm', 'base-mainnet', false, true),
(42161, 'evm', 'arbitrum-one', false, true),
(5042, 'evm', 'arc-mainnet', false, true),
(4217, 'evm', 'tempo-mainnet', false, true)
ON CONFLICT (chain_id) DO NOTHING;

INSERT INTO rpc_endpoints(chain_id, id, provider, role, tier, priority, public_url, budget_group) VALUES
(8453, 'base-mainnet-publicnode', 'publicnode', 'primary', 'public', 10, 'https://base-rpc.publicnode.com', 'publicnode-public'),
(8453, 'base-mainnet-pocket', 'pocket', 'primary', 'public', 20, 'https://base.api.pocket.network', 'pocket-public'),
(8453, 'base-mainnet-thirdweb', 'thirdweb', 'primary', 'public', 40, 'https://8453.rpc.thirdweb.com', 'thirdweb-public'),
(42161, 'arbitrum-one-official', 'arbitrum', 'primary', 'public', 10, 'https://arb1.arbitrum.io/rpc', 'arbitrum-public'),
(42161, 'arbitrum-one-pocket', 'pocket', 'primary', 'public', 20, 'https://arb-one.api.pocket.network', 'pocket-public'),
(42161, 'arbitrum-one-thirdweb', 'thirdweb', 'primary', 'public', 40, 'https://42161.rpc.thirdweb.com', 'thirdweb-public'),
(5042, 'arc-mainnet-blockdaemon', 'blockdaemon', 'primary', 'public', 10, 'https://rpc.blockdaemon.mainnet.arc.io', 'blockdaemon-public'),
(5042, 'arc-mainnet-blockdaemon-wss', 'blockdaemon', 'primary', 'public', 10, 'wss://rpc.blockdaemon.mainnet.arc.io/websocket', 'blockdaemon-public'),
(5042, 'arc-mainnet-publicnode', 'publicnode', 'primary', 'public', 20, 'https://arc-rpc.publicnode.com', 'publicnode-public'),
(5042, 'arc-mainnet-thirdweb', 'thirdweb', 'primary', 'public', 40, 'https://5042.rpc.thirdweb.com', 'thirdweb-public'),
(4217, 'tempo-mainnet-official', 'tempo', 'primary', 'public', 10, 'https://rpc.mainnet.tempo.xyz', 'tempo-public'),
(4217, 'tempo-mainnet-official-wss', 'tempo', 'primary', 'public', 10, 'wss://rpc.mainnet.tempo.xyz', 'tempo-public'),
(4217, 'tempo-mainnet-rpc', 'tempo', 'primary', 'public', 20, 'https://rpc.tempo.xyz', 'tempo-public'),
(4217, 'tempo-mainnet-rpc-wss', 'tempo', 'primary', 'public', 20, 'wss://rpc.tempo.xyz', 'tempo-public')
ON CONFLICT (chain_id, id) DO NOTHING;

-- +goose Down
DELETE FROM rpc_endpoints WHERE chain_id IN (8453, 42161, 5042, 4217);
DELETE FROM chains WHERE chain_id IN (8453, 42161, 5042, 4217);
