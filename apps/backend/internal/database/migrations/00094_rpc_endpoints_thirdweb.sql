-- Public endpoints measured on 2026-10-30 (F405). thirdweb is a new provider with its own budget group; without a key
-- it answers logs over up to 1000 blocks and batches of up to 25 calls, and the pool sends larger ones elsewhere.
-- Tenderly answers a 100-call batch with a rate limit, and PublicNode's WebSockets answer part of a batch, then go
-- quiet: both are turned off, not removed, so an environment can turn them back on.
-- +goose Up
INSERT INTO rpc_endpoints(chain_id, id, provider, role, tier, priority, public_url, budget_group) VALUES
(84532, 'base-thirdweb', 'thirdweb', 'primary', 'public', 40, 'https://84532.rpc.thirdweb.com', 'thirdweb-public'),
(421614, 'arbitrum-thirdweb', 'thirdweb', 'primary', 'public', 40, 'https://421614.rpc.thirdweb.com', 'thirdweb-public'),
(5042002, 'arc-thirdweb', 'thirdweb', 'primary', 'public', 40, 'https://5042002.rpc.thirdweb.com', 'thirdweb-public')
ON CONFLICT (chain_id, id) DO NOTHING;
UPDATE rpc_endpoints SET enabled = false
WHERE id IN ('base-tenderly', 'arbitrum-tenderly', 'base-publicnode-wss', 'arbitrum-publicnode-wss', 'arc-publicnode-wss');

-- +goose Down
UPDATE rpc_endpoints SET enabled = true
WHERE id IN ('base-tenderly', 'arbitrum-tenderly', 'base-publicnode-wss', 'arbitrum-publicnode-wss', 'arc-publicnode-wss');
DELETE FROM rpc_endpoints WHERE id IN ('base-thirdweb', 'arbitrum-thirdweb', 'arc-thirdweb');
