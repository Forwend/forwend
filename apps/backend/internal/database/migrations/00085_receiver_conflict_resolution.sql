-- +goose Up
ALTER TABLE receiver_conflicts ADD COLUMN missing_transfer boolean GENERATED ALWAYS AS
    (observed @> '{"missingTransfer":true}'::jsonb) STORED;
ALTER TABLE receiver_conflicts DROP CONSTRAINT receiver_conflicts_pkey;
ALTER TABLE receiver_conflicts ADD PRIMARY KEY (chain_id, block_hash, log_index, missing_transfer);

CREATE TABLE receiver_conflict_resolutions (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    log_index bigint NOT NULL,
    missing_transfer boolean NOT NULL DEFAULT true CHECK (missing_transfer),
    chain_transfer_id bigint NOT NULL REFERENCES receiver_deposit_proofs (chain_transfer_id),
    verified_block bigint NOT NULL CHECK (verified_block >= 0),
    verified_hash text NOT NULL CHECK (verified_hash ~ '^0x[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, block_hash, log_index),
    FOREIGN KEY (chain_id, block_hash, log_index, missing_transfer)
        REFERENCES receiver_conflicts (chain_id, block_hash, log_index, missing_transfer)
);

-- +goose StatementBegin
CREATE FUNCTION receiver_conflict_resolution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM receiver_conflicts c JOIN receiver_deposit_proofs p
          ON p.chain_transfer_id = c.existing_transfer_id AND p.invoice_id = c.invoice_id
        JOIN chain_transfers d ON d.id=p.chain_transfer_id
        WHERE c.chain_id = NEW.chain_id AND c.block_hash = NEW.block_hash AND c.log_index = NEW.log_index
          AND c.missing_transfer AND c.existing_transfer_id = NEW.chain_transfer_id
          AND d.block_number <= NEW.verified_block
    ) THEN
        RAISE EXCEPTION 'resolution requires the missing transfer exact deposit proof';
    END IF;
    RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER receiver_conflict_resolutions_source BEFORE INSERT ON receiver_conflict_resolutions
    FOR EACH ROW EXECUTE FUNCTION receiver_conflict_resolution_guard();
CREATE TRIGGER receiver_conflict_resolutions_append_only BEFORE UPDATE OR DELETE ON receiver_conflict_resolutions
    FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER receiver_conflict_resolutions_truncate BEFORE TRUNCATE ON receiver_conflict_resolutions
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();

CREATE VIEW receiver_unresolved_conflicts AS
SELECT c.* FROM receiver_conflicts c WHERE NOT c.missing_transfer OR NOT EXISTS (
    SELECT 1 FROM receiver_conflict_resolutions r WHERE r.chain_id=c.chain_id
      AND r.block_hash=c.block_hash AND r.log_index=c.log_index
);

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM receiver_conflict_resolutions) THEN
        RAISE EXCEPTION 'cannot roll back verified conflict resolutions';
    END IF;
    IF EXISTS (SELECT 1 FROM receiver_conflicts GROUP BY chain_id,block_hash,log_index HAVING count(*)>1) THEN
        RAISE EXCEPTION 'cannot merge distinct receiver conflicts';
    END IF;
END $$;
-- +goose StatementEnd
DROP VIEW receiver_unresolved_conflicts;
DROP TABLE receiver_conflict_resolutions;
DROP FUNCTION receiver_conflict_resolution_guard();
ALTER TABLE receiver_conflicts DROP CONSTRAINT receiver_conflicts_pkey;
ALTER TABLE receiver_conflicts DROP COLUMN missing_transfer;
ALTER TABLE receiver_conflicts ADD PRIMARY KEY (chain_id, block_hash, log_index);
