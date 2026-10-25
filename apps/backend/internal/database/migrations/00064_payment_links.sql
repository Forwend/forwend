-- Payment links (R-140, D-54, D-94): a template a payer pays through at /l/<slug>. Amounts are USD cents. A fixed
-- link has amount_cents; an open one has neither, or the owner's min and max.

-- +goose Up
CREATE TABLE payment_links (
    id uuid PRIMARY KEY,
    profile_id uuid NOT NULL REFERENCES profiles (id),
    -- A merchant's store; NULL for a freelancer, who has none.
    store_id uuid,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]{12}$'),
    title text NOT NULL,
    amount_cents bigint CHECK (amount_cents > 0),
    min_cents bigint CHECK (min_cents > 0),
    max_cents bigint CHECK (max_cents > 0),
    ends_at timestamptz,
    max_payments integer CHECK (max_payments > 0),
    active boolean NOT NULL DEFAULT true,
    visits bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (store_id, profile_id) REFERENCES stores (id, profile_id),
    CHECK (amount_cents IS NULL OR (min_cents IS NULL AND max_cents IS NULL)),
    CHECK (min_cents <= max_cents),
    UNIQUE (id, profile_id)
);
CREATE INDEX payment_links_profile ON payment_links (profile_id, created_at);

-- The invoices a link made, for its paid count: only the link's own profile's.
ALTER TABLE invoices ADD COLUMN link_id uuid;
ALTER TABLE invoices ADD CONSTRAINT invoices_link_fkey FOREIGN KEY (link_id, profile_id)
    REFERENCES payment_links (id, profile_id);
CREATE INDEX invoices_link ON invoices (link_id) WHERE link_id IS NOT NULL;

CREATE OR REPLACE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status, m.return_url, c.canceled_at, m.client_country,
       m.client_tax_id, m.supply_date, m.reference, m.agreed_currency, m.agreed_amount,
       m.agreed_decimals, m.agreed_date, m.pay_token, c.closes_at, c.receiver_deployed_at, m.store_id, m.link_id
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
       m.agreed_decimals, m.agreed_date, m.pay_token, c.closes_at, c.receiver_deployed_at, m.store_id
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;
DROP INDEX invoices_link;
ALTER TABLE invoices DROP COLUMN link_id;
DROP TABLE payment_links;
