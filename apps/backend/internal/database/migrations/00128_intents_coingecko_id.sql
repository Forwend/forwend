-- Each 1Click token keeps the CoinGecko id 1Click names for it (R-250): the web finds a logo file it ships by that id.
-- +goose Up
ALTER TABLE intents_tokens ADD COLUMN coingecko_id text CHECK (coingecko_id ~ '^[a-z0-9-]{1,64}$');

-- +goose Down
ALTER TABLE intents_tokens DROP COLUMN coingecko_id;
