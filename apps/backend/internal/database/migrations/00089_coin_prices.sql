-- CoinGecko's USD prices of the stablecoins, for display only (R-178, D-115): one row per coin, kept by the worker.

-- +goose Up
CREATE TABLE coin_prices (
    coin_id text PRIMARY KEY CHECK (coin_id ~ '^[a-z0-9-]{1,64}$'),
    usd numeric NOT NULL CHECK (usd > 0 AND usd < 1e6), -- also refuses NaN and Infinity
    source_updated_at timestamptz NOT NULL,
    fetched_at timestamptz NOT NULL
);

-- +goose Down
DROP TABLE coin_prices;
