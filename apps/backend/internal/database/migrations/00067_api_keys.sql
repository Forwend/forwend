-- Secret API keys (R-144, D-87): a key acts for its profile, and for one store of a merchant, within its scopes. Only
-- its SHA-256 is kept; the text is shown once. A rolled key keeps working until expires_at; a revoked one at once stops.

-- +goose Up
CREATE TABLE api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles (id),
    -- A merchant key's store; NULL for a freelancer's.
    store_id uuid,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    livemode boolean NOT NULL,
    secret_hash bytea NOT NULL UNIQUE CHECK (length(secret_hash) = 32),
    last4 text NOT NULL CHECK (last4 ~ '^[0-9A-Za-z]{4}$'),
    -- apikey.Scopes: none moves money (D-61, D-95).
    scopes text[] NOT NULL CHECK (cardinality(scopes) > 0
        AND scopes <@ ARRAY['invoices.read', 'invoices.write', 'stores.read', 'tokens.read']),
    created_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    expires_at timestamptz,
    revoked_at timestamptz,
    FOREIGN KEY (store_id, profile_id) REFERENCES stores (id, profile_id)
);
CREATE INDEX api_keys_profile ON api_keys (profile_id, created_at);

-- +goose Down
DROP TABLE api_keys;
