-- Durable receiver evidence and its financial attribution (R-164).
-- +goose Up
ALTER TABLE invoices ALTER COLUMN closes_at SET EXPRESSION AS (
    least(greatest(expires_at, reopened_until), CASE WHEN receiver_deployed_at > 0
        THEN least(settle_deadline, receiver_deployed_at + 2592000) - 86400
        ELSE greatest(expires_at, reopened_until) END)
);
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

CREATE TABLE receiver_outflows (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id text NOT NULL REFERENCES invoices (id),
    chain_id bigint NOT NULL,
    receiver_address text NOT NULL CHECK (receiver_address ~ '^0x[0-9a-f]{40}$'),
    token_contract text NOT NULL CHECK (token_contract ~ '^0x[0-9a-f]{40}$'),
    kind text NOT NULL CHECK (kind IN ('settlement', 'refund', 'recovery')),
    destination text NOT NULL CHECK (destination ~ '^0x[0-9a-f]{40}$'),
    amount uint256 NOT NULL CHECK (amount > 0),
    tx_hash text NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
    log_index bigint NOT NULL CHECK (log_index >= 0),
    block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
    block_number bigint NOT NULL CHECK (block_number >= 0),
    block_time bigint NOT NULL CHECK (block_time >= 0),
    verified_block bigint NOT NULL CHECK (verified_block >= block_number),
    transfer_log_index bigint CHECK (transfer_log_index >= 0),
    ledger_transaction_id bigint UNIQUE,
    reconciliation_error text NOT NULL DEFAULT 'awaiting_booking',
    policy_exception text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (chain_id, block_hash, log_index),
    UNIQUE (chain_id, tx_hash, log_index),
    FOREIGN KEY (ledger_transaction_id, invoice_id) REFERENCES ledger_transactions (id, invoice_id)
);
CREATE UNIQUE INDEX receiver_outflows_transfer ON receiver_outflows (chain_id, block_hash, transfer_log_index)
    WHERE transfer_log_index IS NOT NULL;
CREATE INDEX receiver_outflows_invoice ON receiver_outflows (invoice_id, block_number, log_index);

-- +goose StatementBegin
CREATE FUNCTION receiver_outflow_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'receiver observations are permanent';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.id, NEW.invoice_id, NEW.chain_id, NEW.receiver_address, NEW.token_contract, NEW.kind,
            NEW.destination, NEW.amount, NEW.tx_hash, NEW.log_index, NEW.block_hash, NEW.block_number,
            NEW.block_time, NEW.verified_block, NEW.transfer_log_index, NEW.created_at) IS DISTINCT FROM
           (OLD.id, OLD.invoice_id, OLD.chain_id, OLD.receiver_address, OLD.token_contract, OLD.kind,
            OLD.destination, OLD.amount, OLD.tx_hash, OLD.log_index, OLD.block_hash, OLD.block_number,
            OLD.block_time, OLD.verified_block, OLD.transfer_log_index, OLD.created_at) THEN
            RAISE EXCEPTION 'receiver observation evidence never changes';
        END IF;
        IF OLD.ledger_transaction_id IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'booked receiver observation never changes';
        END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND chain_id = NEW.chain_id
        AND receive_address = NEW.receiver_address) THEN
        RAISE EXCEPTION 'receiver observation belongs to its invoice and chain';
    END IF;
    IF NEW.ledger_transaction_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
        WHERE t.id = NEW.ledger_transaction_id AND t.invoice_id = NEW.invoice_id AND t.kind = NEW.kind
          AND e.account = 'receiver' AND e.amount = -NEW.amount
    ) THEN
        RAISE EXCEPTION 'receiver observation must match its financial booking';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER receiver_outflow_guard BEFORE INSERT OR UPDATE OR DELETE ON receiver_outflows
    FOR EACH ROW EXECUTE FUNCTION receiver_outflow_guard();
CREATE TRIGGER receiver_outflow_truncate BEFORE TRUNCATE ON receiver_outflows
    FOR EACH STATEMENT EXECUTE FUNCTION receiver_outflow_guard();

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

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM invoices i JOIN ledger_transactions t ON t.invoice_id = i.id
        WHERE i.closes_at < greatest(i.expires_at, i.reopened_until))
        OR EXISTS (SELECT 1 FROM receiver_outflows) OR EXISTS (SELECT 1 FROM ledger_checkpoints) OR EXISTS (SELECT 1 FROM receiver_funding) OR EXISTS (SELECT 1 FROM receiver_conflicts) OR EXISTS (SELECT 1 FROM receiver_deposit_proofs) THEN
        RAISE EXCEPTION 'cannot discard receiver evidence or financial positions';
    END IF;
END $$;
-- +goose StatementEnd
DROP TABLE ledger_checkpoints;
DROP TABLE receiver_funding;
DROP TRIGGER receiver_verified_transfer_guard ON chain_transfers;
DROP FUNCTION receiver_verified_transfer_guard();
DROP TABLE receiver_deposit_proofs;
DROP FUNCTION receiver_deposit_proof_guard();
DROP TABLE receiver_conflicts;
DROP TABLE receiver_outflows;
DROP FUNCTION receiver_outflow_guard();
DROP TRIGGER receiver_scan_start ON invoices;
DROP FUNCTION receiver_scan_start();
DROP TABLE receiver_scans;
ALTER TABLE invoices ALTER COLUMN closes_at SET EXPRESSION AS (greatest(expires_at, reopened_until));
