-- The chain's finalized block when a deposit was first seen (R-73): the blocks it had to wait then are the m of
-- "Confirming (n/m)", the same after a reload or on another device. Kept from the first insert; null on rows from
-- before this column, which then count from what is left.

-- +goose Up
ALTER TABLE chain_transfers ADD COLUMN detected_finalized_block bigint CHECK (detected_finalized_block >= 0);

-- +goose Down
ALTER TABLE chain_transfers DROP COLUMN detected_finalized_block;
