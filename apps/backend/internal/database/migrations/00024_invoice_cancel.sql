-- Cancel (R-79, D-79): the owner can cancel an open invoice before any money arrives. Canceled is final: it never
-- settles, and money sent to it later is held for the payer (D-26). Every row of a payer-chooses invoice is canceled
-- together, at one time.

-- +goose Up
ALTER TABLE invoices DROP CONSTRAINT invoices_payment_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_payment_status_check
    CHECK (payment_status IN ('open', 'detected', 'partially_paid', 'paid', 'expired', 'expired_partially_paid', 'canceled'));
ALTER TABLE invoices ADD COLUMN canceled_at timestamptz;
ALTER TABLE invoices ADD CONSTRAINT invoices_canceled_at_check CHECK ((canceled_at IS NOT NULL) = (payment_status = 'canceled'));

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
        ('partially_paid', 'expired_partially_paid'), ('open', 'canceled')) THEN
        RAISE EXCEPTION 'invoice % payment status % -> % is not allowed', OLD.id, OLD.payment_status, NEW.payment_status;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- The view lists its columns, so it is made again with the new one.
CREATE OR REPLACE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status, m.return_url, c.canceled_at
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;

-- +goose Down
DROP VIEW invoices_current;
CREATE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status, m.return_url
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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

ALTER TABLE invoices DROP CONSTRAINT invoices_canceled_at_check;
ALTER TABLE invoices DROP COLUMN canceled_at;
ALTER TABLE invoices DROP CONSTRAINT invoices_payment_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_payment_status_check CHECK (payment_status IN ('open', 'detected', 'partially_paid', 'paid', 'expired', 'expired_partially_paid'));
