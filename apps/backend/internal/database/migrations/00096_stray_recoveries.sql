-- Money an invoice option doesn't take, sent to its receive address (D-33): support prints a recover for one
-- transfer at a time, and this row holds it until it is released, so the same transfer is never returned twice. A
-- released row stays, so release always counts the chain's recovers from the first transfer ever locked.
-- +goose Up
CREATE TABLE stray_recoveries (
    chain_id bigint NOT NULL,
    tx_hash text NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
    log_index bigint NOT NULL CHECK (log_index >= 0),
    block_number bigint NOT NULL CHECK (block_number >= 0),
    invoice_id text NOT NULL REFERENCES invoices (id),
    token_contract text NOT NULL CHECK (token_contract ~ '^0x[0-9a-f]{40}$'),
    destination text NOT NULL CHECK (destination ~ '^0x[0-9a-f]{40}$'),
    amount numeric(78, 0) NOT NULL CHECK (amount > 0),
    queued_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz,
    PRIMARY KEY (chain_id, tx_hash, log_index)
);

-- +goose Down
DROP TABLE stray_recoveries;
