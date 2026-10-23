-- Records in an ECB currency (R-110, D-82): the ECB's daily euro rates, and a profile's currency besides USD.

-- +goose Up
CREATE TABLE ecb_rates (
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'EUR'),
    day date NOT NULL,
    per_eur numeric NOT NULL CHECK (per_eur > 0 AND per_eur < 1e12), -- also refuses NaN and Infinity
    PRIMARY KEY (currency, day)
);
ALTER TABLE profiles ADD COLUMN records_currency text
    CHECK (records_currency ~ '^[A-Z]{3}$' AND records_currency <> 'USD');

-- +goose Down
ALTER TABLE profiles DROP COLUMN records_currency;
DROP TABLE ecb_rates;
