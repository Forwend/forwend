-- The signer reads these on every settle: the executor's saved settles still sent (its nonce floor), and the settles
-- signed in the last 24 hours (the sponsored cap). Without them both reads grow with every settlement ever made.
-- CONCURRENTLY: building them does not block writes to a live table; it can run only outside a transaction.
-- +goose NO TRANSACTION
-- +goose Up
CREATE INDEX CONCURRENTLY IF NOT EXISTS settlement_intents_sent ON settlement_intents (sender, nonce) WHERE status = 'sent';
CREATE INDEX CONCURRENTLY IF NOT EXISTS settlement_intents_signed ON settlement_intents (signed_at) WHERE signed_at IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS settlement_intents_signed;
DROP INDEX CONCURRENTLY IF EXISTS settlement_intents_sent;
