-- Reopen (R-130): an expired, partly paid invoice takes payments again until reopened_until, once.

-- +goose Up
ALTER TABLE invoices ADD COLUMN reopened_until bigint
    CHECK (reopened_until > expires_at AND reopened_until < settle_deadline);
-- Every reader of "closed" and "late" uses this one close: the terms' expiry, or the reopened one.
ALTER TABLE invoices ADD COLUMN closes_at bigint GENERATED ALWAYS AS (greatest(expires_at, reopened_until)) STORED;

ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check
    CHECK (kind IN ('deposit', 'settlement', 'refund', 'reversal', 'expiry', 'reopen'));
-- A reopen names the deposit whose held money it gives back, or none for the money the expiry moved.
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_check
    CHECK (kind = 'reopen' OR (kind = 'deposit') = (chain_transfer_id IS NOT NULL));
DROP INDEX ledger_transactions_one_deposit;
CREATE UNIQUE INDEX ledger_transactions_one_deposit ON ledger_transactions (chain_transfer_id) WHERE kind = 'deposit';
CREATE UNIQUE INDEX ledger_transactions_one_reopen ON ledger_transactions (invoice_id, coalesce(chain_transfer_id, 0))
    WHERE kind = 'reopen';
DROP INDEX ledger_transactions_one_expiry;

-- +goose StatementBegin
-- Reopen rows come after the first expiry and before a second; a second expiry only after them. The ledger holds
-- the invoice row while it books, so two of them never count at once.
CREATE FUNCTION ledger_expiry_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    expiries bigint;
    reopens bigint;
BEGIN
    SELECT count(*) FILTER (WHERE kind = 'expiry'), count(*) FILTER (WHERE kind = 'reopen') INTO expiries, reopens
    FROM ledger_transactions WHERE invoice_id = NEW.invoice_id;
    IF NEW.kind = 'expiry' AND expiries > 0 AND NOT (expiries = 1 AND reopens > 0)
       OR NEW.kind = 'reopen' AND expiries <> 1 THEN
        RAISE EXCEPTION 'invoice % % out of turn', NEW.invoice_id, NEW.kind;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER ledger_expiry_order BEFORE INSERT ON ledger_transactions
    FOR EACH ROW WHEN (NEW.kind IN ('expiry', 'reopen')) EXECUTE FUNCTION ledger_expiry_order();

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.payment_status <> 'open' OR NEW.reopened_until IS NOT NULL THEN
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
        ('partially_paid', 'expired_partially_paid'), ('open', 'canceled'))
       AND NOT ((OLD.payment_status, NEW.payment_status) = ('expired_partially_paid', 'partially_paid')
                AND OLD.reopened_until IS NULL AND NEW.reopened_until IS NOT NULL) THEN
        RAISE EXCEPTION 'invoice % payment status % -> % is not allowed', OLD.id, OLD.payment_status, NEW.payment_status;
    END IF;
    IF NEW.reopened_until IS DISTINCT FROM OLD.reopened_until AND (OLD.reopened_until IS NOT NULL
       OR (OLD.payment_status, NEW.payment_status) <> ('expired_partially_paid', 'partially_paid')) THEN
        RAISE EXCEPTION 'invoice % reopens once, from expired partly paid', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE OR REPLACE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status, m.return_url, c.canceled_at, m.client_country,
       m.client_tax_id, m.supply_date, m.reference, m.agreed_currency, m.agreed_amount,
       m.agreed_decimals, m.agreed_date, m.pay_token, c.closes_at
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;

-- +goose Down
DROP VIEW invoices_current;
CREATE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status, m.return_url, c.canceled_at, m.client_country,
       m.client_tax_id, m.supply_date, m.reference, m.agreed_currency, m.agreed_amount,
       m.agreed_decimals, m.agreed_date, m.pay_token
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
        ('partially_paid', 'expired_partially_paid'), ('open', 'canceled')) THEN
        RAISE EXCEPTION 'invoice % payment status % -> % is not allowed', OLD.id, OLD.payment_status, NEW.payment_status;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

DROP TRIGGER ledger_expiry_order ON ledger_transactions;
DROP FUNCTION ledger_expiry_order();
DROP INDEX ledger_transactions_one_reopen;
CREATE UNIQUE INDEX ledger_transactions_one_expiry ON ledger_transactions (invoice_id) WHERE kind = 'expiry';
DROP INDEX ledger_transactions_one_deposit;
CREATE UNIQUE INDEX ledger_transactions_one_deposit ON ledger_transactions (chain_transfer_id);
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_check
    CHECK ((kind = 'deposit') = (chain_transfer_id IS NOT NULL));
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check
    CHECK (kind IN ('deposit', 'settlement', 'refund', 'reversal', 'expiry'));
ALTER TABLE invoices DROP COLUMN closes_at, DROP COLUMN reopened_until;
