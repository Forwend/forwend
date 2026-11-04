-- An unbooked receiver event recorded without its token transfer, as when a node answered part of the logs, may get
-- that transfer once a later scan or the signer's receipt finds it. Nothing else about an observation changes.
-- +goose Up
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION receiver_outflow_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'receiver observations are permanent';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.id, NEW.invoice_id, NEW.chain_id, NEW.receiver_address, NEW.token_contract, NEW.kind,
            NEW.destination, NEW.amount, NEW.tx_hash, NEW.log_index, NEW.block_hash, NEW.block_number,
            NEW.block_time, NEW.verified_block, NEW.created_at) IS DISTINCT FROM
           (OLD.id, OLD.invoice_id, OLD.chain_id, OLD.receiver_address, OLD.token_contract, OLD.kind,
            OLD.destination, OLD.amount, OLD.tx_hash, OLD.log_index, OLD.block_hash, OLD.block_number,
            OLD.block_time, OLD.verified_block, OLD.created_at) THEN
            RAISE EXCEPTION 'receiver observation evidence never changes';
        END IF;
        -- The one change: an unbooked event recorded without its transfer gets it once it is found.
        IF NEW.transfer_log_index IS DISTINCT FROM OLD.transfer_log_index AND (OLD.transfer_log_index IS NOT NULL
            OR NEW.transfer_log_index IS NULL OR OLD.ledger_transaction_id IS NOT NULL) THEN
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

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION receiver_outflow_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
