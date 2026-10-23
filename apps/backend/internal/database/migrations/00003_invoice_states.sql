-- Invoice states (R-21).

-- +goose Up
-- An expired partial payment is never settled to the creator (D-26): an expiry transaction moves it to payer_held.
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check
    CHECK (kind IN ('deposit', 'settlement', 'refund', 'reversal', 'expiry'));
CREATE UNIQUE INDEX ledger_transactions_one_expiry ON ledger_transactions (invoice_id) WHERE kind = 'expiry';

-- The finalized block's time: expiry and the payer's countdown are decided by chain time (D-45, R-28).
ALTER TABLE chain_cursors ADD COLUMN last_finalized_time bigint NOT NULL DEFAULT 0 CHECK (last_finalized_time >= 0);

-- +goose StatementBegin
CREATE FUNCTION invoices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.payment_status <> 'open' THEN
            RAISE EXCEPTION 'invoice % must start open', NEW.id;
        END IF;
        RETURN NEW;
    END IF;
    IF (NEW.id, NEW.profile_id, NEW.chain_id, NEW.chain_family, NEW.token_contract, NEW.amount, NEW.expires_at,
        NEW.settle_deadline, NEW.recipient_address, NEW.receive_method, NEW.factory_address, NEW.receive_address,
        NEW.idempotency_key, NEW.request_hash, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.profile_id, OLD.chain_id, OLD.chain_family, OLD.token_contract, OLD.amount, OLD.expires_at,
        OLD.settle_deadline, OLD.recipient_address, OLD.receive_method, OLD.factory_address, OLD.receive_address,
        OLD.idempotency_key, OLD.request_hash, OLD.created_at) THEN
        RAISE EXCEPTION 'invoice % terms never change', OLD.id;
    END IF;
    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status AND (OLD.payment_status, NEW.payment_status) NOT IN (
        ('open', 'detected'), ('detected', 'open'),
        ('open', 'partially_paid'), ('detected', 'partially_paid'),
        ('open', 'paid'), ('detected', 'paid'), ('partially_paid', 'paid'),
        ('open', 'expired'), ('detected', 'expired'),
        ('open', 'expired_partially_paid'), ('detected', 'expired_partially_paid'),
        ('partially_paid', 'expired_partially_paid')) THEN
        RAISE EXCEPTION 'invoice % payment status % -> % is not allowed', OLD.id, OLD.payment_status, NEW.payment_status;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER invoices_guard BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_guard();
ALTER TABLE invoices ENABLE ALWAYS TRIGGER invoices_guard;

-- +goose Down
DROP TRIGGER invoices_guard ON invoices;
DROP FUNCTION invoices_guard();
ALTER TABLE chain_cursors DROP COLUMN last_finalized_time;
DROP INDEX ledger_transactions_one_expiry;
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check
    CHECK (kind IN ('deposit', 'settlement', 'refund', 'reversal'));
