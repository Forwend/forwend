-- R-245: when the worker's dry quote last found no liquidity for a token; the picker leaves it out until a later dry
-- quote is answered.
-- +goose Up
ALTER TABLE intents_tokens ADD COLUMN no_liquidity_at timestamptz;

-- +goose Down
ALTER TABLE intents_tokens DROP COLUMN no_liquidity_at;
