-- The signer reads these on every settle: the executor's saved settles still sent (its nonce floor), and the settles
-- signed in the last 24 hours (the sponsored cap). Without them both reads grow with every settlement ever made.
-- +goose Up
CREATE INDEX settlement_intents_sent ON settlement_intents (sender, nonce) WHERE status = 'sent';
CREATE INDEX settlement_intents_signed ON settlement_intents (signed_at) WHERE signed_at IS NOT NULL;

-- +goose Down
DROP INDEX settlement_intents_signed;
DROP INDEX settlement_intents_sent;
