-- R-234: the worker's cross-chain alerts read only quotes whose deposit was seen in the last week, or still read.
-- +goose Up
CREATE INDEX crosschain_quotes_seen ON crosschain_quotes (deposit_seen_at) WHERE deposit_seen_at IS NOT NULL;

-- +goose Down
DROP INDEX crosschain_quotes_seen;
