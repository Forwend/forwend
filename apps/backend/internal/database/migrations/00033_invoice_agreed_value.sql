-- Agreed price in fiat (R-93), typed by the owner (no exchange-rate API). In minor units with its decimals, so a
-- currency later dropped from the list still reads right.

-- +goose Up
ALTER TABLE invoices
    ADD COLUMN agreed_currency text CHECK (agreed_currency ~ '^[A-Z]{3}$'),
    ADD COLUMN agreed_amount bigint CHECK (agreed_amount > 0),
    ADD COLUMN agreed_decimals smallint CHECK (agreed_decimals BETWEEN 0 AND 3),
    ADD COLUMN agreed_date date,
    ADD CHECK ((agreed_currency IS NULL) = (agreed_amount IS NULL) AND (agreed_amount IS NULL) = (agreed_decimals IS NULL)
        AND (agreed_decimals IS NULL) = (agreed_date IS NULL));

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoices_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.main_id IS NOT NULL THEN
        SELECT number INTO NEW.number FROM invoices WHERE id = NEW.main_id;
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        UPDATE profiles SET invoice_seq = invoice_seq + 1 WHERE id = NEW.profile_id
            RETURNING invoice_seq INTO NEW.number;
        -- With no row, SELECT INTO sets every target to NULL.
        SELECT name, address, country, tax_id, contact_email
            INTO NEW.issuer_name, NEW.issuer_address, NEW.issuer_country, NEW.issuer_tax_id, NEW.issuer_email
            FROM profile_billing_details WHERE profile_id = NEW.profile_id;
        RETURN NEW;
    END IF;
    IF (NEW.number, NEW.title, NEW.note, NEW.due_date, NEW.client_name, NEW.client_email, NEW.client_address,
        NEW.client_country, NEW.client_tax_id, NEW.issuer_name, NEW.issuer_address, NEW.issuer_country,
        NEW.issuer_tax_id, NEW.issuer_email, NEW.sender_name, NEW.return_url, NEW.supply_date, NEW.reference,
        NEW.agreed_currency, NEW.agreed_amount, NEW.agreed_decimals, NEW.agreed_date)
       IS DISTINCT FROM
       (OLD.number, OLD.title, OLD.note, OLD.due_date, OLD.client_name, OLD.client_email, OLD.client_address,
        OLD.client_country, OLD.client_tax_id, OLD.issuer_name, OLD.issuer_address, OLD.issuer_country,
        OLD.issuer_tax_id, OLD.issuer_email, OLD.sender_name, OLD.return_url, OLD.supply_date, OLD.reference,
        OLD.agreed_currency, OLD.agreed_amount, OLD.agreed_decimals, OLD.agreed_date) THEN
        RAISE EXCEPTION 'invoice % number and details never change', OLD.id;
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
       m.agreed_decimals, m.agreed_date
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
       m.client_tax_id, m.supply_date, m.reference
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoices_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.main_id IS NOT NULL THEN
        SELECT number INTO NEW.number FROM invoices WHERE id = NEW.main_id;
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        UPDATE profiles SET invoice_seq = invoice_seq + 1 WHERE id = NEW.profile_id
            RETURNING invoice_seq INTO NEW.number;
        -- With no row, SELECT INTO sets every target to NULL.
        SELECT name, address, country, tax_id, contact_email
            INTO NEW.issuer_name, NEW.issuer_address, NEW.issuer_country, NEW.issuer_tax_id, NEW.issuer_email
            FROM profile_billing_details WHERE profile_id = NEW.profile_id;
        RETURN NEW;
    END IF;
    IF (NEW.number, NEW.title, NEW.note, NEW.due_date, NEW.client_name, NEW.client_email, NEW.client_address,
        NEW.client_country, NEW.client_tax_id, NEW.issuer_name, NEW.issuer_address, NEW.issuer_country,
        NEW.issuer_tax_id, NEW.issuer_email, NEW.sender_name, NEW.return_url, NEW.supply_date, NEW.reference)
       IS DISTINCT FROM
       (OLD.number, OLD.title, OLD.note, OLD.due_date, OLD.client_name, OLD.client_email, OLD.client_address,
        OLD.client_country, OLD.client_tax_id, OLD.issuer_name, OLD.issuer_address, OLD.issuer_country,
        OLD.issuer_tax_id, OLD.issuer_email, OLD.sender_name, OLD.return_url, OLD.supply_date, OLD.reference) THEN
        RAISE EXCEPTION 'invoice % number and details never change', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
ALTER TABLE invoices DROP COLUMN agreed_date, DROP COLUMN agreed_decimals, DROP COLUMN agreed_amount,
    DROP COLUMN agreed_currency;
