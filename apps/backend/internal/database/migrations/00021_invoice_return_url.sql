-- Return link (R-58, R-62): set at creation and never changes. An option row has none.

-- +goose Up
ALTER TABLE invoices ADD COLUMN return_url text
    CHECK (char_length(return_url) BETWEEN 9 AND 2000 AND return_url LIKE 'https://%');

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
        NEW.issuer_name, NEW.issuer_address, NEW.issuer_country, NEW.issuer_tax_id, NEW.issuer_email, NEW.sender_name,
        NEW.return_url)
       IS DISTINCT FROM
       (OLD.number, OLD.title, OLD.note, OLD.due_date, OLD.client_name, OLD.client_email, OLD.client_address,
        OLD.issuer_name, OLD.issuer_address, OLD.issuer_country, OLD.issuer_tax_id, OLD.issuer_email, OLD.sender_name,
        OLD.return_url) THEN
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
       c.payment_status, c.settlement_status, c.refund_status, m.return_url
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;

-- +goose Down
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
        SELECT name, address, country, tax_id, contact_email
            INTO NEW.issuer_name, NEW.issuer_address, NEW.issuer_country, NEW.issuer_tax_id, NEW.issuer_email
            FROM profile_billing_details WHERE profile_id = NEW.profile_id;
        RETURN NEW;
    END IF;
    IF (NEW.number, NEW.title, NEW.note, NEW.due_date, NEW.client_name, NEW.client_email, NEW.client_address,
        NEW.issuer_name, NEW.issuer_address, NEW.issuer_country, NEW.issuer_tax_id, NEW.issuer_email, NEW.sender_name)
       IS DISTINCT FROM
       (OLD.number, OLD.title, OLD.note, OLD.due_date, OLD.client_name, OLD.client_email, OLD.client_address,
        OLD.issuer_name, OLD.issuer_address, OLD.issuer_country, OLD.issuer_tax_id, OLD.issuer_email, OLD.sender_name) THEN
        RAISE EXCEPTION 'invoice % number and details never change', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
DROP VIEW invoices_current;
CREATE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;
ALTER TABLE invoices DROP COLUMN return_url;
