-- Records (R-108): the label a user gives money in that is neither an invoice payment nor a transfer between their own
-- profiles. One per profile and transfer log; money in without one is unclassified.

-- +goose Up
CREATE TABLE transfer_labels (
    profile_id uuid NOT NULL REFERENCES profiles (id),
    chain_id bigint NOT NULL,
    tx_hash text NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
    log_index bigint NOT NULL CHECK (log_index >= 0),
    label text NOT NULL CHECK (label IN ('income', 'own_transfer', 'refund', 'other')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, chain_id, tx_hash, log_index)
);

-- +goose Down
DROP TABLE transfer_labels;
