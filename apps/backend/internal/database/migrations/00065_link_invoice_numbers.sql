-- A payment-link invoice (D-50, D-54, R-141) has no number until the ledger books its first deposit. It then takes
-- the profile's next number in that transaction; a number never changes once set.

-- +goose Up
ALTER TABLE invoices ALTER COLUMN number DROP NOT NULL,
    ADD CONSTRAINT invoices_number_or_link CHECK (number IS NOT NULL OR link_id IS NOT NULL);

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

-- +goose Down
-- +goose StatementBegin
-- The old schema needs a number on every invoice; giving one now would break D-50's order.
DO $$
DECLARE
    unnumbered bigint := (SELECT count(*) FROM invoices WHERE number IS NULL);
BEGIN
    IF unnumbered > 0 THEN
        RAISE EXCEPTION 'can''t roll back: % payment-link invoice row(s) have no number yet (R-141)', unnumbered;
    END IF;
END;
$$;
-- +goose StatementEnd
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
    IF (NEW.number, NEW.title, NEW.client_name, NEW.client_address,
        NEW.client_country, NEW.client_tax_id, NEW.issuer_name, NEW.issuer_address, NEW.issuer_country,
        NEW.issuer_tax_id, NEW.issuer_email, NEW.sender_name, NEW.supply_date,
        NEW.agreed_currency, NEW.agreed_amount, NEW.agreed_decimals, NEW.agreed_date)
       IS DISTINCT FROM
       (OLD.number, OLD.title, OLD.client_name, OLD.client_address,
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
ALTER TABLE invoices DROP CONSTRAINT invoices_number_or_link, ALTER COLUMN number SET NOT NULL;
