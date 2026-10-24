-- Stores (D-30, R-134): a merchant profile's shops or projects. Each merchant invoice records one.

-- +goose Up
CREATE TABLE stores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- the project ID, public and with no authority (D-31)
    profile_id uuid NOT NULL REFERENCES profiles (id),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
    -- An invoice's expiresIn bounds (D-18).
    default_expires_in integer NOT NULL DEFAULT 604800 CHECK (default_expires_in BETWEEN 900 AND 31536000),
    allowed_origins text[] NOT NULL DEFAULT '{}' CHECK (cardinality(allowed_origins) <= 20),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, profile_id)
);
CREATE INDEX stores_profile ON stores (profile_id, created_at);

-- +goose StatementBegin
CREATE FUNCTION profiles_first_store() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO stores (profile_id, name) VALUES (NEW.id, coalesce(NEW.name, 'Main store'));
    RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER profiles_first_store AFTER INSERT ON profiles FOR EACH ROW WHEN (NEW.kind = 'merchant')
    EXECUTE FUNCTION profiles_first_store();

-- The origins of the profile's return links, so the links they already have stay allowed.
INSERT INTO stores (profile_id, name, allowed_origins)
SELECT p.id, coalesce(p.name, 'Main store'), coalesce((
    SELECT (array_agg(DISTINCT o ORDER BY o) FILTER (WHERE o IS NOT NULL))[1:20]
    FROM (SELECT regexp_replace(substring(lower(i.return_url) FROM '^https://[^/?#]+'), ':443$', '') AS o
          FROM invoices i WHERE i.profile_id = p.id AND i.return_url IS NOT NULL) x), '{}')
FROM profiles p WHERE p.kind = 'merchant';

ALTER TABLE invoices ADD COLUMN store_id uuid, ADD FOREIGN KEY (store_id, profile_id) REFERENCES stores (id, profile_id);
UPDATE invoices i SET store_id = s.id FROM stores s WHERE s.profile_id = i.profile_id;

-- +goose StatementBegin
CREATE FUNCTION invoices_store_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'invoice % store never changes', OLD.id;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER invoices_store_fixed BEFORE UPDATE ON invoices FOR EACH ROW
    WHEN (OLD.store_id IS DISTINCT FROM NEW.store_id) EXECUTE FUNCTION invoices_store_fixed();

CREATE OR REPLACE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status, m.return_url, c.canceled_at, m.client_country,
       m.client_tax_id, m.supply_date, m.reference, m.agreed_currency, m.agreed_amount,
       m.agreed_decimals, m.agreed_date, m.pay_token, c.closes_at, c.receiver_deployed_at, m.store_id
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
       m.agreed_decimals, m.agreed_date, m.pay_token, c.closes_at, c.receiver_deployed_at
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;
DROP TRIGGER invoices_store_fixed ON invoices;
DROP FUNCTION invoices_store_fixed();
ALTER TABLE invoices DROP COLUMN store_id;
DROP TRIGGER profiles_first_store ON profiles;
DROP FUNCTION profiles_first_store();
DROP TABLE stores;
