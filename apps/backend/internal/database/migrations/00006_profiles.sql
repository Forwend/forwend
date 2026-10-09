-- Profiles get an optional name, and the Idempotency-Key of the request that created them (R-32). The personal
-- profile is made at signup without a key.

-- +goose Up
ALTER TABLE profiles
    ADD COLUMN name text CHECK (char_length(name) BETWEEN 1 AND 64),
    ADD COLUMN idempotency_key text CHECK (length(idempotency_key) BETWEEN 1 AND 255),
    ADD COLUMN request_hash bytea CHECK (length(request_hash) = 32), -- SHA-256 of the create request, never the body
    ADD CONSTRAINT profiles_key_with_hash CHECK ((idempotency_key IS NULL) = (request_hash IS NULL)),
    ADD CONSTRAINT profiles_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key);

-- +goose Down
ALTER TABLE profiles DROP COLUMN request_hash, DROP COLUMN idempotency_key, DROP COLUMN name;
