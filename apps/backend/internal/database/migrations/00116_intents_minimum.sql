-- D-126: the Base USDC base units 1Click needs at least from each token, learned from dry quotes and refusals; null
-- when it named none at the last check.
-- +goose Up
ALTER TABLE intents_tokens
    ADD COLUMN minimum numeric(78, 0) CHECK (minimum > 0),
    ADD COLUMN minimum_checked_at timestamptz;

-- +goose Down
ALTER TABLE intents_tokens DROP COLUMN minimum, DROP COLUMN minimum_checked_at;
