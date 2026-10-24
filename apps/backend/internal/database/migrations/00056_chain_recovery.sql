-- +goose Up
CREATE TABLE chain_recoveries (
    chain_id bigint PRIMARY KEY REFERENCES chains(chain_id),
    completed_block bigint NOT NULL CHECK (completed_block >= 0),
    next_block bigint CHECK (next_block >= 0),
    target_block bigint CHECK (target_block >= 0),
    next_at timestamptz NOT NULL DEFAULT now(),
    subscriptions text NOT NULL DEFAULT '',
    CHECK ((next_block IS NULL) = (target_block IS NULL))
);
INSERT INTO chain_recoveries (chain_id, completed_block)
SELECT chain_id, last_finalized_block FROM chain_cursors;

-- +goose Down
DROP TABLE chain_recoveries;
