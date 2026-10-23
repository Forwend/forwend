-- Payer chooses (R-56, D-75, D-76): each option is an invoice row of its own. The main row (main_id NULL) is the
-- one people see; chosen_id names the option paid first, and money on any other option is held for the payer.

-- +goose Up
ALTER TABLE invoices
    ADD COLUMN main_id text REFERENCES invoices (id),
    ADD COLUMN chosen_id text REFERENCES invoices (id),
    ADD CONSTRAINT invoices_main_not_self CHECK (main_id <> id),
    ADD CONSTRAINT invoices_chosen_on_main CHECK (main_id IS NULL OR chosen_id IS NULL);
CREATE INDEX invoices_main ON invoices (main_id) WHERE main_id IS NOT NULL;

-- Numbers and idempotency keys name invoices, not options: options repeat their main row's.
ALTER TABLE invoices DROP CONSTRAINT invoices_profile_id_number_key;
CREATE UNIQUE INDEX invoices_profile_number ON invoices (profile_id, number) WHERE main_id IS NULL;
ALTER TABLE invoices DROP CONSTRAINT invoices_profile_id_idempotency_key_key;
CREATE UNIQUE INDEX invoices_profile_idempotency_key ON invoices (profile_id, idempotency_key) WHERE main_id IS NULL;

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

-- +goose StatementBegin
CREATE FUNCTION invoices_options() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.chosen_id IS NOT NULL THEN
            RAISE EXCEPTION 'invoice % starts with no chosen option', NEW.id;
        END IF;
        IF NEW.main_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoices m WHERE m.id = NEW.main_id
            AND m.main_id IS NULL AND m.chosen_id IS NULL AND m.profile_id = NEW.profile_id
            AND m.recipient_address = NEW.recipient_address AND m.factory_address = NEW.factory_address
            AND m.receive_method = NEW.receive_method AND m.expires_at = NEW.expires_at
            AND m.settle_deadline = NEW.settle_deadline AND m.idempotency_key = NEW.idempotency_key
            AND m.request_hash = NEW.request_hash) THEN
            RAISE EXCEPTION 'invoice option % must share its main invoice''s recipient, expiry and request', NEW.id;
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.main_id IS DISTINCT FROM OLD.main_id THEN
        RAISE EXCEPTION 'invoice % option group never changes', OLD.id;
    END IF;
    IF NEW.chosen_id IS DISTINCT FROM OLD.chosen_id AND (OLD.chosen_id IS NOT NULL
        OR NOT (NEW.chosen_id = NEW.id OR EXISTS (SELECT 1 FROM invoices o WHERE o.id = NEW.chosen_id
                                                   AND o.main_id = NEW.id))) THEN
        RAISE EXCEPTION 'invoice % chosen option is set once, to one of its options', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER invoices_options BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_options();
ALTER TABLE invoices ENABLE ALWAYS TRIGGER invoices_options;

-- One row per invoice people see: the main row's details with the chosen option's terms, else its own.
CREATE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;

-- +goose Down
DROP VIEW invoices_current;
DROP TRIGGER invoices_options ON invoices;
DROP FUNCTION invoices_options();
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoices_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
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
DROP INDEX invoices_profile_idempotency_key;
ALTER TABLE invoices ADD CONSTRAINT invoices_profile_id_idempotency_key_key UNIQUE (profile_id, idempotency_key);
DROP INDEX invoices_profile_number;
ALTER TABLE invoices ADD CONSTRAINT invoices_profile_id_number_key UNIQUE (profile_id, number);
DROP INDEX invoices_main;
ALTER TABLE invoices DROP COLUMN chosen_id, DROP COLUMN main_id;
