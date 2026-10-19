-- The time of the block a chain's scan read to (R-119): a payer-chooses invoice picks the option paid first only once
-- every other option chain was read past that payment.

-- +goose Up
ALTER TABLE chain_cursors ADD COLUMN last_scanned_time bigint NOT NULL DEFAULT 0 CHECK (last_scanned_time >= 0);

-- +goose Down
ALTER TABLE chain_cursors DROP COLUMN last_scanned_time;
