-- A settle the signer drops to sign again keeps its signed versions, so every transaction the executor signed for an
-- invoice stays listed. Each cmd/ops run keeps the OS user who ran it and its arguments.
-- +goose Up
CREATE TABLE settlement_dropped (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    intent_id bigint NOT NULL REFERENCES settlement_intents (id),
    sender text,
    nonce bigint NOT NULL,
    tx_hash text NOT NULL,
    raw_tx bytea NOT NULL,
    replaced_hashes text[] NOT NULL,
    reason text NOT NULL,
    dropped_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX settlement_dropped_intent ON settlement_dropped (intent_id);

CREATE TABLE ops_runs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at timestamptz NOT NULL DEFAULT now(),
    operator text NOT NULL CHECK (operator <> ''),
    args text[] NOT NULL
);

-- +goose Down
DROP TABLE ops_runs;
DROP TABLE settlement_dropped;
