-- Webhook endpoints (R-146, D-42): where a profile's events go, and the secrets that sign them. A secret is kept sealed
-- with WEBHOOK_SECRET_KEY (AES-256-GCM, bound to its endpoint), never as text. A rotated secret signs until expires_at.

-- +goose Up
CREATE TABLE webhook_endpoints (
    id uuid PRIMARY KEY,
    profile_id uuid NOT NULL REFERENCES profiles (id),
    -- A merchant endpoint's one store; NULL for all of them, and for a freelancer's.
    store_id uuid,
    url text NOT NULL CHECK (url ~ '^https://' AND length(url) <= 2048),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 200),
    events text[] NOT NULL CHECK (cardinality(events) > 0),
    enabled boolean NOT NULL DEFAULT true,
    livemode boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (store_id, profile_id) REFERENCES stores (id, profile_id)
);
CREATE INDEX webhook_endpoints_profile ON webhook_endpoints (profile_id, created_at);

CREATE TABLE webhook_secrets (
    id bigserial PRIMARY KEY,
    endpoint_id uuid NOT NULL REFERENCES webhook_endpoints (id) ON DELETE CASCADE,
    sealed bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz
);
CREATE INDEX webhook_secrets_endpoint ON webhook_secrets (endpoint_id);
-- One current secret per endpoint; a rotation sets the last one's expires_at first.
CREATE UNIQUE INDEX webhook_secrets_current ON webhook_secrets (endpoint_id) WHERE expires_at IS NULL;

-- +goose Down
DROP TABLE webhook_secrets;
DROP TABLE webhook_endpoints;
