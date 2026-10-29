-- The chain's scan of every watched receive address records deposits and receiver events (R-181, D-116); the separate
-- per-receiver evidence it replaces is dropped. Booked movements and their receiver_outflows rows stay.
-- +goose Up
-- Receiver events a lagging receiver scan had not read yet sit below the chain scan's overlap: recovery reads them.
-- Only a receiver that received money can settle or refund, so options never paid don't deepen the sweep.
UPDATE chain_recoveries r SET next_block = least(coalesce(r.next_block, lag.next_block), lag.next_block),
    target_block = coalesce(r.target_block, cur.last_finalized_block)
FROM (SELECT i.chain_id, min(s.next_block) AS next_block FROM receiver_scans s JOIN invoices i ON i.id = s.invoice_id
      WHERE NOT s.legacy AND i.settle_deadline > extract(epoch FROM now())::bigint - 2592000
        AND EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = i.id AND t.status <> 'reorged')
      GROUP BY i.chain_id) lag
JOIN chain_cursors cur ON cur.chain_id = lag.chain_id
WHERE r.chain_id = lag.chain_id AND lag.next_block <= cur.last_finalized_block;
DROP TRIGGER receiver_scan_start ON invoices;
DROP FUNCTION receiver_scan_start();
DROP VIEW receiver_unresolved_conflicts;
DROP TABLE receiver_conflict_resolutions;
DROP FUNCTION receiver_conflict_resolution_guard();
DROP TABLE receiver_conflicts;
DROP TRIGGER receiver_verified_transfer_guard ON chain_transfers;
DROP FUNCTION receiver_verified_transfer_guard();
DROP TABLE receiver_funding;
DROP TABLE receiver_deposit_proofs;
DROP FUNCTION receiver_deposit_proof_guard();
DROP TABLE ledger_checkpoints;
DROP TABLE receiver_scans;

-- +goose Down
-- Every receiver gets a legacy scan from block 0 again, as migration 78 gave the invoices before it.
CREATE TABLE receiver_scans (
    invoice_id text PRIMARY KEY REFERENCES invoices (id),
    legacy boolean NOT NULL DEFAULT false,
    start_block bigint NOT NULL CHECK (start_block >= 0),
    next_block bigint NOT NULL CHECK (next_block >= start_block),
    opening_checked boolean NOT NULL DEFAULT false,
    history_complete boolean NOT NULL DEFAULT false,
    scanned_block bigint,
    scanned_hash text CHECK (scanned_hash ~ '^0x[0-9a-f]{64}$'),
    block_time bigint,
    balance uint256,
    reconciliation_error text,
    booking_error text,
    retry_at timestamptz,
    next_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((scanned_block IS NULL) = (scanned_hash IS NULL)),
    CHECK ((scanned_block IS NULL) = (balance IS NULL)),
    CHECK (scanned_block IS NULL OR scanned_block >= start_block)
);
INSERT INTO receiver_scans (invoice_id, start_block, next_block, legacy) SELECT id, 0, 0, true FROM invoices;

-- +goose StatementBegin
CREATE FUNCTION receiver_scan_start() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    start_at bigint;
BEGIN
    SELECT coalesce((SELECT last_finalized_block FROM chain_cursors WHERE chain_id = NEW.chain_id), 0) INTO start_at;
    INSERT INTO receiver_scans (invoice_id, start_block, next_block) VALUES (NEW.id, start_at, start_at);
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER receiver_scan_start AFTER INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION receiver_scan_start();

CREATE TABLE receiver_conflicts (
    invoice_id text NOT NULL REFERENCES invoices (id),
    chain_id bigint NOT NULL REFERENCES chains (chain_id),
    block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
    log_index bigint NOT NULL CHECK (log_index >= 0),
    existing_transfer_id bigint NOT NULL REFERENCES chain_transfers (id),
    observed jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, block_hash, log_index)
);
CREATE TRIGGER receiver_conflicts_append_only BEFORE UPDATE OR DELETE ON receiver_conflicts
    FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER receiver_conflicts_truncate BEFORE TRUNCATE ON receiver_conflicts
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();

CREATE TABLE receiver_deposit_proofs (
    chain_transfer_id bigint PRIMARY KEY,
    invoice_id text NOT NULL,
    verified_block bigint NOT NULL CHECK (verified_block >= 0),
    verified_hash text NOT NULL CHECK (verified_hash ~ '^0x[0-9a-f]{64}$'),
    FOREIGN KEY (chain_transfer_id, invoice_id) REFERENCES chain_transfers (id, invoice_id)
);
CREATE INDEX receiver_deposit_proofs_invoice ON receiver_deposit_proofs (invoice_id);
CREATE TRIGGER receiver_deposit_proofs_append_only BEFORE UPDATE OR DELETE ON receiver_deposit_proofs
    FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER receiver_deposit_proofs_truncate BEFORE TRUNCATE ON receiver_deposit_proofs
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
-- +goose StatementBegin
CREATE FUNCTION receiver_deposit_proof_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM chain_transfers WHERE id = NEW.chain_transfer_id AND invoice_id = NEW.invoice_id
        AND status = 'confirmed' AND block_number <= NEW.verified_block) THEN
        RAISE EXCEPTION 'receiver proof requires its confirmed transfer';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER receiver_deposit_proof_guard BEFORE INSERT ON receiver_deposit_proofs
    FOR EACH ROW EXECUTE FUNCTION receiver_deposit_proof_guard();
-- +goose StatementBegin
CREATE FUNCTION receiver_verified_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM receiver_deposit_proofs WHERE chain_transfer_id = OLD.id) THEN
        IF TG_OP = 'DELETE' OR (NEW.id, NEW.invoice_id, NEW.chain_id, NEW.chain_family, NEW.token_contract,
            NEW.tx_hash, NEW.log_index, NEW.block_hash, NEW.block_number, NEW.block_time, NEW.from_address,
            NEW.to_address, NEW.amount, NEW.status, NEW.detected_finalized_block, NEW.created_at)
            IS DISTINCT FROM (OLD.id, OLD.invoice_id, OLD.chain_id, OLD.chain_family, OLD.token_contract,
            OLD.tx_hash, OLD.log_index, OLD.block_hash, OLD.block_number, OLD.block_time, OLD.from_address,
            OLD.to_address, OLD.amount, OLD.status, OLD.detected_finalized_block, OLD.created_at)
            OR OLD.booked AND NOT NEW.booked THEN
            RAISE EXCEPTION 'verified receiver transfer evidence never changes';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER receiver_verified_transfer_guard BEFORE UPDATE OR DELETE ON chain_transfers
    FOR EACH ROW EXECUTE FUNCTION receiver_verified_transfer_guard();

CREATE TABLE receiver_funding (
    invoice_id text PRIMARY KEY REFERENCES invoices (id),
    chain_transfer_id bigint NOT NULL,
    verified_block bigint NOT NULL CHECK (verified_block >= 0),
    verified_hash text NOT NULL CHECK (verified_hash ~ '^0x[0-9a-f]{64}$'),
    FOREIGN KEY (chain_transfer_id, invoice_id) REFERENCES chain_transfers (id, invoice_id)
);
CREATE TRIGGER receiver_funding_append_only BEFORE UPDATE OR DELETE ON receiver_funding
    FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER receiver_funding_truncate BEFORE TRUNCATE ON receiver_funding
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();

CREATE TABLE ledger_checkpoints (
    transaction_id bigint PRIMARY KEY REFERENCES ledger_transactions (id),
    block_number bigint NOT NULL CHECK (block_number >= 0),
    block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$')
);
CREATE TRIGGER ledger_checkpoints_append_only BEFORE UPDATE OR DELETE ON ledger_checkpoints
    FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER ledger_checkpoints_truncate BEFORE TRUNCATE ON ledger_checkpoints
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();


ALTER TABLE receiver_scans ADD COLUMN failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0);
CREATE INDEX receiver_scans_due ON receiver_scans (legacy, next_at, invoice_id);


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
