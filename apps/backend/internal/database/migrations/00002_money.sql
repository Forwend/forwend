-- Money tables (R-17). Rules and sources: docs/backend/architecture.md#data-model.

-- +goose Up
-- Token amounts in base units. NUMERIC(78,0) alone accepts up to 10^78-1, so the range is checked.
CREATE DOMAIN uint256 AS numeric(78, 0)
    CHECK (VALUE >= 0 AND VALUE <= 115792089237316195423570985008687907853269984665640564039457584007913129639935);

CREATE TABLE chains (
    chain_id bigint PRIMARY KEY CHECK (chain_id > 0),
    chain_family text NOT NULL CHECK (chain_family IN ('evm')),
    name text NOT NULL UNIQUE,
    enabled boolean NOT NULL DEFAULT false,
    UNIQUE (chain_id, chain_family)
);

CREATE TABLE tokens (
    chain_id bigint NOT NULL,
    chain_family text NOT NULL,
    contract text NOT NULL,
    symbol text NOT NULL,
    decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 77),
    enabled boolean NOT NULL DEFAULT false,
    PRIMARY KEY (chain_id, contract),
    FOREIGN KEY (chain_id, chain_family) REFERENCES chains (chain_id, chain_family),
    CHECK (chain_family <> 'evm' OR contract ~ '^0x[0-9a-f]{40}$')
);

CREATE TABLE profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id),
    kind text NOT NULL CHECK (kind IN ('personal', 'freelancer', 'merchant')),
    created_at timestamptz NOT NULL DEFAULT now()
);
-- One personal profile per user, created at signup (D-21).
CREATE UNIQUE INDEX profiles_one_personal ON profiles (user_id) WHERE kind = 'personal';

CREATE TABLE profile_wallets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles (id),
    provider text NOT NULL CHECK (provider IN ('privy')),
    provider_wallet_id text NOT NULL,
    chain_family text NOT NULL CHECK (chain_family IN ('evm')),
    address text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_wallet_id),
    UNIQUE (chain_family, address),
    UNIQUE (profile_id, chain_family),
    CHECK (chain_family <> 'evm' OR address ~ '^0x[0-9a-f]{40}$')
);

-- Terms are the contract's InvoiceTerms and never change; expires_at and settle_deadline are its uint64 seconds.
CREATE TABLE invoices (
    id text PRIMARY KEY CHECK (id ~ '^0x[0-9a-f]{64}$'),
    profile_id uuid NOT NULL REFERENCES profiles (id),
    chain_id bigint NOT NULL,
    chain_family text NOT NULL,
    token_contract text NOT NULL,
    amount uint256 NOT NULL CHECK (amount > 0),
    expires_at bigint NOT NULL CHECK (expires_at > 0),
    settle_deadline bigint NOT NULL CHECK (settle_deadline >= expires_at),
    recipient_address text NOT NULL,
    receive_method text NOT NULL CHECK (receive_method IN ('evm_create2')),
    factory_address text NOT NULL,
    receive_address text NOT NULL,
    payment_status text NOT NULL DEFAULT 'open'
        CHECK (payment_status IN ('open', 'detected', 'partially_paid', 'paid', 'expired', 'expired_partially_paid')),
    settlement_status text NOT NULL DEFAULT 'none' CHECK (settlement_status IN ('none', 'pending', 'settled')),
    refund_status text NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'held', 'refund_pending', 'refunded')),
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
    request_hash bytea NOT NULL CHECK (length(request_hash) = 32), -- SHA-256 of the create request, never the body
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (chain_id, receive_address),
    UNIQUE (profile_id, idempotency_key),
    UNIQUE (id, chain_id, token_contract, receive_address),
    FOREIGN KEY (chain_id, chain_family) REFERENCES chains (chain_id, chain_family),
    FOREIGN KEY (chain_id, token_contract) REFERENCES tokens (chain_id, contract),
    CHECK (chain_family <> 'evm' OR (recipient_address ~ '^0x[0-9a-f]{40}$' AND factory_address ~ '^0x[0-9a-f]{40}$'
        AND receive_address ~ '^0x[0-9a-f]{40}$'))
);

-- Allowlisted-token Transfer logs to receive addresses. log_index is the log's position in its block. After a reorg
-- the row stays as 'reorged' and the same transaction may be mined again, possibly with the same log index, so
-- (tx_hash, log_index) is unique only among rows that are not reorged.
CREATE TABLE chain_transfers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chain_id bigint NOT NULL,
    chain_family text NOT NULL,
    token_contract text NOT NULL,
    invoice_id text NOT NULL,
    tx_hash text NOT NULL,
    log_index bigint NOT NULL CHECK (log_index >= 0),
    block_hash text NOT NULL,
    block_number bigint NOT NULL CHECK (block_number >= 0),
    block_time bigint NOT NULL CHECK (block_time >= 0),
    from_address text NOT NULL,
    to_address text NOT NULL,
    amount uint256 NOT NULL CHECK (amount > 0),
    status text NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'confirmed', 'reorged')),
    booked boolean NOT NULL DEFAULT false, -- set only by a ledger deposit, then the row never changes
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (chain_id, block_hash, log_index),
    UNIQUE (id, invoice_id),
    FOREIGN KEY (chain_id, chain_family) REFERENCES chains (chain_id, chain_family),
    -- Only the invoice's token, on its chain, to its receive address.
    FOREIGN KEY (invoice_id, chain_id, token_contract, to_address)
        REFERENCES invoices (id, chain_id, token_contract, receive_address),
    CHECK (chain_family <> 'evm' OR (tx_hash ~ '^0x[0-9a-f]{64}$' AND block_hash ~ '^0x[0-9a-f]{64}$'
        AND from_address ~ '^0x[0-9a-f]{40}$' AND to_address ~ '^0x[0-9a-f]{40}$'))
);
CREATE UNIQUE INDEX chain_transfers_live_log ON chain_transfers (chain_id, tx_hash, log_index) WHERE status <> 'reorged';
CREATE INDEX chain_transfers_invoice ON chain_transfers (invoice_id);

-- Double-entry ledger. Each invoice has three accounts: receiver (the tokens at its receive address),
-- recipient_payable (owed to the creator) and payer_held (owed to payers). Entries are signed (debit > 0, credit < 0)
-- and every transaction sums to zero, so the receiver balance always equals what is owed. Only finalized transfers
-- are booked (D-45). Rows never change; a mistake is fixed by a reversal transaction.
CREATE TABLE ledger_transactions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id text NOT NULL REFERENCES invoices (id),
    kind text NOT NULL CHECK (kind IN ('deposit', 'settlement', 'refund', 'reversal')),
    chain_transfer_id bigint,
    reverses_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, invoice_id),
    -- A deposit books a transfer of the same invoice; a reversal reverses a transaction of the same invoice.
    FOREIGN KEY (chain_transfer_id, invoice_id) REFERENCES chain_transfers (id, invoice_id),
    FOREIGN KEY (reverses_id, invoice_id) REFERENCES ledger_transactions (id, invoice_id),
    CHECK ((kind = 'deposit') = (chain_transfer_id IS NOT NULL)),
    CHECK ((kind = 'reversal') = (reverses_id IS NOT NULL))
);
-- A transfer is booked once; a transaction is reversed at most once.
CREATE UNIQUE INDEX ledger_transactions_one_deposit ON ledger_transactions (chain_transfer_id);
CREATE UNIQUE INDEX ledger_transactions_one_reversal ON ledger_transactions (reverses_id);

CREATE TABLE ledger_entries (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_id bigint NOT NULL REFERENCES ledger_transactions (id),
    account text NOT NULL CHECK (account IN ('receiver', 'recipient_payable', 'payer_held')),
    amount numeric(78, 0) NOT NULL
        CHECK (amount <> 0 AND abs(amount) <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
    UNIQUE (transaction_id, account)
);

-- +goose StatementBegin
CREATE FUNCTION ledger_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % rejected', TG_TABLE_NAME, TG_OP;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT sum(amount) FROM ledger_entries WHERE transaction_id = NEW.transaction_id) <> 0 THEN
        RAISE EXCEPTION 'ledger transaction % does not balance', NEW.transaction_id;
    END IF;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION ledger_check_has_entries() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT count(*) FROM ledger_entries WHERE transaction_id = NEW.id) < 2 THEN
        RAISE EXCEPTION 'ledger transaction % has fewer than 2 entries', NEW.id;
    END IF;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd

-- A deposit books a confirmed, unbooked transfer and marks it booked. The write (not just a lock) makes a concurrent
-- status change fail at every isolation level: READ COMMITTED re-reads the booked row, REPEATABLE READ and
-- SERIALIZABLE get a serialization failure.
-- +goose StatementBegin
CREATE FUNCTION ledger_check_deposit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind = 'deposit' THEN
        UPDATE chain_transfers SET booked = true WHERE id = NEW.chain_transfer_id AND status = 'confirmed' AND NOT booked;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'transfer % is not confirmed or already booked', NEW.chain_transfer_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- A booked transfer never changes: marking it reorged would let a re-mined copy be booked again.
-- +goose StatementBegin
CREATE FUNCTION chain_transfers_reject_booked_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.booked THEN
        RAISE EXCEPTION 'transfer % is booked in the ledger and cannot change', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- At commit, booked is true exactly when a ledger deposit books the transfer. Reads the current row: one transaction
-- can queue several events for it.
-- +goose StatementBegin
CREATE FUNCTION chain_transfers_check_booked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT booked FROM chain_transfers WHERE id = NEW.id)
        IS DISTINCT FROM EXISTS (SELECT 1 FROM ledger_transactions WHERE chain_transfer_id = NEW.id) THEN
        RAISE EXCEPTION 'transfer % booked flag does not match the ledger', NEW.id;
    END IF;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd

-- ENABLE ALWAYS: the guards also fire with session_replication_role = replica. TRUNCATE skips row triggers.
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
    FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER ledger_transactions_no_truncate BEFORE TRUNCATE ON ledger_transactions
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
-- Checked at commit, after all entries of the transaction are in.
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();
CREATE CONSTRAINT TRIGGER ledger_transactions_has_entries AFTER INSERT ON ledger_transactions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_has_entries();
CREATE TRIGGER ledger_transactions_deposit BEFORE INSERT ON ledger_transactions
    FOR EACH ROW EXECUTE FUNCTION ledger_check_deposit();
CREATE TRIGGER chain_transfers_booked BEFORE UPDATE ON chain_transfers
    FOR EACH ROW EXECUTE FUNCTION chain_transfers_reject_booked_change();
CREATE CONSTRAINT TRIGGER chain_transfers_booked_matches_ledger AFTER INSERT OR UPDATE ON chain_transfers
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION chain_transfers_check_booked();
ALTER TABLE ledger_transactions ENABLE ALWAYS TRIGGER ledger_transactions_append_only;
ALTER TABLE ledger_transactions ENABLE ALWAYS TRIGGER ledger_transactions_no_truncate;
ALTER TABLE ledger_entries ENABLE ALWAYS TRIGGER ledger_entries_append_only;
ALTER TABLE ledger_entries ENABLE ALWAYS TRIGGER ledger_entries_no_truncate;
ALTER TABLE ledger_entries ENABLE ALWAYS TRIGGER ledger_entries_balanced;
ALTER TABLE ledger_transactions ENABLE ALWAYS TRIGGER ledger_transactions_has_entries;
ALTER TABLE ledger_transactions ENABLE ALWAYS TRIGGER ledger_transactions_deposit;
ALTER TABLE chain_transfers ENABLE ALWAYS TRIGGER chain_transfers_booked;
ALTER TABLE chain_transfers ENABLE ALWAYS TRIGGER chain_transfers_booked_matches_ledger;

-- One settlement per invoice (R-22). The signer reconciles by nonce and tx hash before any retry.
CREATE TABLE settlement_intents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id text NOT NULL UNIQUE REFERENCES invoices (id),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'confirmed', 'failed')),
    nonce bigint CHECK (nonce >= 0),
    tx_hash text CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (status = 'pending' OR tx_hash IS NOT NULL)
);
CREATE INDEX settlement_intents_due ON settlement_intents (next_attempt_at) WHERE status IN ('pending', 'sent');

-- The watcher's position per chain. Blocks at or below last_finalized_block are final (D-45).
CREATE TABLE chain_cursors (
    chain_id bigint PRIMARY KEY REFERENCES chains (chain_id),
    last_scanned_block bigint NOT NULL CHECK (last_scanned_block >= 0),
    last_finalized_block bigint NOT NULL CHECK (last_finalized_block >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (last_finalized_block <= last_scanned_block)
);

-- Events written in the same transaction as the change; a worker publishes them at least once.
CREATE TABLE outbox_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind text NOT NULL,
    invoice_id text REFERENCES invoices (id),
    payload jsonb NOT NULL,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);
CREATE INDEX outbox_events_unpublished ON outbox_events (id) WHERE published_at IS NULL;

-- +goose Down
DROP TABLE outbox_events;
DROP TABLE chain_cursors;
DROP TABLE settlement_intents;
DROP TABLE ledger_entries;
DROP TABLE ledger_transactions;
DROP FUNCTION ledger_check_deposit();
DROP FUNCTION ledger_check_has_entries();
DROP FUNCTION ledger_check_balanced();
DROP FUNCTION ledger_reject_change();
DROP TABLE chain_transfers;
DROP FUNCTION chain_transfers_check_booked();
DROP FUNCTION chain_transfers_reject_booked_change();
DROP TABLE invoices;
DROP TABLE profile_wallets;
DROP TABLE profiles;
DROP TABLE tokens;
DROP TABLE chains;
DROP DOMAIN uint256;
