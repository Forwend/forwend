-- The finalized block when a deposit was first seen (R-73): the m of "Confirming (n/m)" on every device. Kept from
-- the first insert; NULL on older rows, which count from what is left.

-- +goose Up
ALTER TABLE chain_transfers ADD COLUMN detected_finalized_block bigint CHECK (detected_finalized_block >= 0);

-- +goose Down
ALTER TABLE chain_transfers DROP COLUMN detected_finalized_block;
