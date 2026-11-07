-- A hash belongs to one send of its wallet. A send of another wallet that names it never matches its transfer, and no
-- longer keeps the wallet's own send from recording it.

-- +goose Up
DROP INDEX sends_tx;
CREATE UNIQUE INDEX sends_tx ON sends (chain_id, from_address, tx_hash) WHERE tx_hash IS NOT NULL;

-- +goose Down
DROP INDEX sends_tx;
CREATE UNIQUE INDEX sends_tx ON sends (chain_id, tx_hash) WHERE tx_hash IS NOT NULL;
