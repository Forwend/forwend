-- Billing details (R-43): one editable row per profile with who bills (name, address, country, tax ID, contact
-- email). Each new invoice keeps a copy as its issuer, and like its other details the copy never changes.

-- +goose Up
CREATE TABLE profile_billing_details (
    profile_id uuid PRIMARY KEY REFERENCES profiles (id),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    address text NOT NULL CHECK (char_length(address) BETWEEN 1 AND 500),
    country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'), -- ISO 3166-1 alpha-2; the API checks the code is assigned
    tax_id text CHECK (char_length(tax_id) BETWEEN 1 AND 50),
    contact_email text NOT NULL CHECK (char_length(contact_email) BETWEEN 1 AND 254),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- The columns take their values only from profile_billing_details, so they need no checks of their own.
ALTER TABLE invoices
    ADD COLUMN issuer_name text,
    ADD COLUMN issuer_address text,
    ADD COLUMN issuer_country text,
    ADD COLUMN issuer_tax_id text,
    ADD COLUMN issuer_email text;

-- The insert copies the profile's billing details in the same statement that takes the number, so the copy is the
-- details as they were when the invoice was made, whatever the insert says. A profile without details gives no issuer.
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
        NEW.issuer_name, NEW.issuer_address, NEW.issuer_country, NEW.issuer_tax_id, NEW.issuer_email)
       IS DISTINCT FROM
       (OLD.number, OLD.title, OLD.note, OLD.due_date, OLD.client_name, OLD.client_email, OLD.client_address,
        OLD.issuer_name, OLD.issuer_address, OLD.issuer_country, OLD.issuer_tax_id, OLD.issuer_email) THEN
        RAISE EXCEPTION 'invoice % number and details never change', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoices_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE profiles SET invoice_seq = invoice_seq + 1 WHERE id = NEW.profile_id
            RETURNING invoice_seq INTO NEW.number;
        RETURN NEW;
    END IF;
    IF (NEW.number, NEW.title, NEW.note, NEW.due_date, NEW.client_name, NEW.client_email, NEW.client_address)
       IS DISTINCT FROM
       (OLD.number, OLD.title, OLD.note, OLD.due_date, OLD.client_name, OLD.client_email, OLD.client_address) THEN
        RAISE EXCEPTION 'invoice % number and details never change', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
ALTER TABLE invoices
    DROP COLUMN issuer_email,
    DROP COLUMN issuer_tax_id,
    DROP COLUMN issuer_country,
    DROP COLUMN issuer_address,
    DROP COLUMN issuer_name;
DROP TABLE profile_billing_details;
