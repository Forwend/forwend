-- Invoice numbers and details (R-42, D-50).

-- +goose Up
ALTER TABLE profiles ADD COLUMN invoice_seq bigint NOT NULL DEFAULT 0 CHECK (invoice_seq >= 0);

ALTER TABLE invoices
    ADD COLUMN number bigint CHECK (number > 0),
    ADD COLUMN title text CHECK (char_length(title) BETWEEN 1 AND 200),
    ADD COLUMN note text CHECK (char_length(note) BETWEEN 1 AND 2000),
    ADD COLUMN due_date date,
    ADD COLUMN client_name text CHECK (char_length(client_name) BETWEEN 1 AND 200),
    ADD COLUMN client_email text CHECK (char_length(client_email) BETWEEN 1 AND 254),
    ADD COLUMN client_address text CHECK (char_length(client_address) BETWEEN 1 AND 500);

UPDATE invoices i SET number = n.number
FROM (SELECT id, row_number() OVER (PARTITION BY profile_id ORDER BY created_at, id) AS number FROM invoices) n
WHERE n.id = i.id;
UPDATE profiles p SET invoice_seq = n.count
FROM (SELECT profile_id, count(*) AS count FROM invoices GROUP BY profile_id) n
WHERE n.profile_id = p.id;
ALTER TABLE invoices
    ALTER COLUMN number SET NOT NULL,
    ADD CONSTRAINT invoices_profile_id_number_key UNIQUE (profile_id, number);

-- A trigger, so every way of creating an invoice gets a number. The counter row stays locked until the transaction
-- ends: creates for one profile take turns, and a failed insert rolls the counter back, so numbers have no gaps.
-- +goose StatementBegin
CREATE FUNCTION invoices_number() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER invoices_number BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_number();
ALTER TABLE invoices ENABLE ALWAYS TRIGGER invoices_number;

-- +goose Down
DROP TRIGGER invoices_number ON invoices;
DROP FUNCTION invoices_number();
ALTER TABLE invoices
    DROP COLUMN client_address,
    DROP COLUMN client_email,
    DROP COLUMN client_name,
    DROP COLUMN due_date,
    DROP COLUMN note,
    DROP COLUMN title,
    DROP COLUMN number;
ALTER TABLE profiles DROP COLUMN invoice_seq;
