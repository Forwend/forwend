-- Explicit payment purpose preserves the shared engine and existing document history (R-161, D-107).
-- +goose Up
ALTER TABLE invoices ADD COLUMN purpose text, ADD COLUMN document_kind text;
UPDATE invoices i SET purpose = CASE WHEN i.link_id IS NOT NULL THEN 'checkout'
    WHEN p.kind = 'personal' THEN 'request' ELSE 'invoice' END,
    document_kind = CASE WHEN p.kind = 'personal' THEN 'request' ELSE 'invoice' END
FROM profiles p WHERE p.id = i.profile_id;
ALTER TABLE invoices ALTER COLUMN purpose SET NOT NULL, ALTER COLUMN document_kind SET NOT NULL,
    DROP CONSTRAINT invoices_number_or_link,
    ADD CONSTRAINT invoices_purpose_document CHECK (
        (purpose = 'invoice' AND document_kind = 'invoice') OR
        (purpose = 'request' AND document_kind = 'request') OR
        (purpose = 'checkout' AND document_kind IN ('none', 'invoice'))),
    ADD CONSTRAINT invoices_document_number CHECK (
        (document_kind = 'none' AND number IS NULL) OR
        (document_kind <> 'none' AND (number IS NOT NULL OR link_id IS NOT NULL)));

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoices_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.main_id IS NOT NULL THEN
            SELECT purpose, document_kind INTO NEW.purpose, NEW.document_kind FROM invoices WHERE id = NEW.main_id;
        ELSE
            NEW.purpose := coalesce(NEW.purpose, CASE WHEN NEW.link_id IS NOT NULL THEN 'checkout'
                WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'personal' THEN 'request' ELSE 'invoice' END);
            NEW.document_kind := coalesce(NEW.document_kind,
                CASE WHEN NEW.purpose = 'request' THEN 'request' ELSE 'invoice' END);
        END IF;
    ELSIF (NEW.purpose, NEW.document_kind) IS DISTINCT FROM (OLD.purpose, OLD.document_kind) THEN
        RAISE EXCEPTION 'payment % purpose and document kind never change', OLD.id;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.main_id IS NOT NULL THEN
        SELECT number INTO NEW.number FROM invoices WHERE id = NEW.main_id;
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.link_id IS NULL AND NEW.document_kind <> 'none' THEN
            UPDATE profiles SET invoice_seq = invoice_seq + 1 WHERE id = NEW.profile_id
                RETURNING invoice_seq INTO NEW.number;
        END IF;
        -- With no row, SELECT INTO sets every target to NULL.
        SELECT name, address, country, tax_id, contact_email
            INTO NEW.issuer_name, NEW.issuer_address, NEW.issuer_country, NEW.issuer_tax_id, NEW.issuer_email
            FROM profile_billing_details WHERE profile_id = NEW.profile_id;
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.document_kind = 'none' AND NEW.reference IS DISTINCT FROM OLD.reference THEN
        RAISE EXCEPTION 'checkout % reference never changes', OLD.id;
    END IF;
    IF (NEW.number, NEW.title, NEW.client_name, NEW.client_address,
        NEW.client_country, NEW.client_tax_id, NEW.issuer_name, NEW.issuer_address, NEW.issuer_country,
        NEW.issuer_tax_id, NEW.issuer_email, NEW.sender_name, NEW.supply_date,
        NEW.agreed_currency, NEW.agreed_amount, NEW.agreed_decimals, NEW.agreed_date)
       IS DISTINCT FROM
       (coalesce(OLD.number, NEW.number), OLD.title, OLD.client_name, OLD.client_address,
        OLD.client_country, OLD.client_tax_id, OLD.issuer_name, OLD.issuer_address, OLD.issuer_country,
        OLD.issuer_tax_id, OLD.issuer_email, OLD.sender_name, OLD.supply_date,
        OLD.agreed_currency, OLD.agreed_amount, OLD.agreed_decimals, OLD.agreed_date) THEN
        RAISE EXCEPTION 'invoice % number and details never change', OLD.id;
    END IF;
    IF (NEW.note, NEW.reference, NEW.due_date) IS DISTINCT FROM (OLD.note, OLD.reference, OLD.due_date)
       AND (OLD.payment_status <> 'open' OR EXISTS (SELECT 1 FROM chain_transfers t JOIN invoices i ON i.id = t.invoice_id
            WHERE coalesce(i.main_id, i.id) = coalesce(OLD.main_id, OLD.id) AND t.status <> 'reorged')) THEN
        RAISE EXCEPTION 'invoice % note, reference and due date change only before any money', OLD.id;
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
       m.agreed_decimals, m.agreed_date, m.pay_token, c.closes_at, c.receiver_deployed_at, m.store_id, m.link_id, m.purpose, m.document_kind
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM invoices WHERE document_kind = 'none') THEN
        RAISE EXCEPTION 'cannot roll back payment purposes while document-free checkout sessions exist';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP VIEW invoices_current;
CREATE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status, m.return_url, c.canceled_at, m.client_country,
       m.client_tax_id, m.supply_date, m.reference, m.agreed_currency, m.agreed_amount,
       m.agreed_decimals, m.agreed_date, m.pay_token, c.closes_at, c.receiver_deployed_at, m.store_id, m.link_id
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
        IF NEW.link_id IS NULL THEN
            UPDATE profiles SET invoice_seq = invoice_seq + 1 WHERE id = NEW.profile_id
                RETURNING invoice_seq INTO NEW.number;
        END IF;
        -- With no row, SELECT INTO sets every target to NULL.
        SELECT name, address, country, tax_id, contact_email
            INTO NEW.issuer_name, NEW.issuer_address, NEW.issuer_country, NEW.issuer_tax_id, NEW.issuer_email
            FROM profile_billing_details WHERE profile_id = NEW.profile_id;
        RETURN NEW;
    END IF;
    IF (NEW.number, NEW.title, NEW.client_name, NEW.client_address,
        NEW.client_country, NEW.client_tax_id, NEW.issuer_name, NEW.issuer_address, NEW.issuer_country,
        NEW.issuer_tax_id, NEW.issuer_email, NEW.sender_name, NEW.supply_date,
        NEW.agreed_currency, NEW.agreed_amount, NEW.agreed_decimals, NEW.agreed_date)
       IS DISTINCT FROM
       (coalesce(OLD.number, NEW.number), OLD.title, OLD.client_name, OLD.client_address,
        OLD.client_country, OLD.client_tax_id, OLD.issuer_name, OLD.issuer_address, OLD.issuer_country,
        OLD.issuer_tax_id, OLD.issuer_email, OLD.sender_name, OLD.supply_date,
        OLD.agreed_currency, OLD.agreed_amount, OLD.agreed_decimals, OLD.agreed_date) THEN
        RAISE EXCEPTION 'invoice % number and details never change', OLD.id;
    END IF;
    IF (NEW.note, NEW.reference, NEW.due_date) IS DISTINCT FROM (OLD.note, OLD.reference, OLD.due_date)
       AND (OLD.payment_status <> 'open' OR EXISTS (SELECT 1 FROM chain_transfers t JOIN invoices i ON i.id = t.invoice_id
            WHERE coalesce(i.main_id, i.id) = coalesce(OLD.main_id, OLD.id) AND t.status <> 'reorged')) THEN
        RAISE EXCEPTION 'invoice % note, reference and due date change only before any money', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
ALTER TABLE invoices DROP CONSTRAINT invoices_purpose_document, DROP CONSTRAINT invoices_document_number,
    DROP COLUMN purpose, DROP COLUMN document_kind,
    ADD CONSTRAINT invoices_number_or_link CHECK (number IS NOT NULL OR link_id IS NOT NULL);
