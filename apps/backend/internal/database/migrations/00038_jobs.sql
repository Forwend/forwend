-- Jobs (R-100, D-81): a quote the client accepts at /w/<token>. Each payment becomes a normal invoice once made,
-- the deposit at acceptance.

-- +goose Up
CREATE TABLE jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles (id),
    token text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{64}$'),
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
    request_hash bytea NOT NULL CHECK (length(request_hash) = 32),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    scope text CHECK (char_length(scope) BETWEEN 1 AND 5000),
    client_name text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 200),
    client_email text NOT NULL CHECK (char_length(client_email) BETWEEN 1 AND 254),
    client_address text CHECK (char_length(client_address) BETWEEN 1 AND 500),
    client_country text CHECK (client_country ~ '^[A-Z]{2}$'),
    client_tax_id text CHECK (char_length(client_tax_id) BETWEEN 1 AND 50),
    -- Copied from profile_billing_details, so they need no checks of their own.
    issuer_name text NOT NULL,
    issuer_address text NOT NULL,
    issuer_country text NOT NULL,
    issuer_tax_id text,
    issuer_email text NOT NULL,
    accepted_name text CHECK (char_length(accepted_name) BETWEEN 1 AND 200),
    accepted_email text CHECK (char_length(accepted_email) BETWEEN 1 AND 254),
    accepted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((accepted_at IS NULL) = (accepted_name IS NULL) AND (accepted_name IS NULL) = (accepted_email IS NULL)),
    UNIQUE (profile_id, idempotency_key)
);
CREATE TABLE job_payments (
    job_id uuid NOT NULL REFERENCES jobs (id),
    position integer NOT NULL CHECK (position BETWEEN 1 AND 10),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    due_days integer NOT NULL CHECK (due_days BETWEEN 0 AND 90),
    on_accept boolean NOT NULL CHECK (NOT on_accept OR position = 1),
    invoice_id text UNIQUE REFERENCES invoices (id),
    PRIMARY KEY (job_id, position)
);

-- +goose Down
DROP TABLE job_payments;
DROP TABLE jobs;
