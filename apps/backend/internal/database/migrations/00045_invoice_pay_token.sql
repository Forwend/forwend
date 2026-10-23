-- The pay link's secret (D-86): an invoice's id is keccak256 of it, so the id the chain shows opens nothing public.
-- Only a main row has one; invoices made before have none, and their public routes are 404.

-- +goose Up
ALTER TABLE invoices ADD COLUMN pay_token text UNIQUE CHECK (pay_token ~ '^[0-9a-f]{64}$'),
    ADD CHECK (pay_token IS NULL OR main_id IS NULL);

CREATE OR REPLACE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status, m.return_url, c.canceled_at, m.client_country,
       m.client_tax_id, m.supply_date, m.reference, m.agreed_currency, m.agreed_amount,
       m.agreed_decimals, m.agreed_date, m.pay_token
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
       m.agreed_decimals, m.agreed_date
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;
ALTER TABLE invoices DROP COLUMN pay_token;
