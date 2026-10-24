-- Reopen (R-130): a receiver deployed early, by a refund authority recovery, settles only until deployedAt + 30 days.

-- +goose Up
-- factory.deployedAt(receive_address), read by the ledger when the option closes partly paid; 0 when not deployed.
-- NULL before that, or for an option that closed before this column: it can't reopen.
ALTER TABLE invoices ADD COLUMN receiver_deployed_at bigint CHECK (receiver_deployed_at >= 0);

CREATE OR REPLACE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status, m.return_url, c.canceled_at, m.client_country,
       m.client_tax_id, m.supply_date, m.reference, m.agreed_currency, m.agreed_amount,
       m.agreed_decimals, m.agreed_date, m.pay_token, c.closes_at, c.receiver_deployed_at
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;

-- A reopened row had the close's UTC day in to; it gets the exact close in until. The close never changes.
ALTER TABLE history_events DISABLE TRIGGER history_events_append_only;
UPDATE history_events h
SET data = h.data - 'to' || jsonb_build_object('until',
    to_char(to_timestamp(o.reopened_until) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
FROM invoices o
WHERE h.kind = 'invoice.reopened' AND coalesce(o.main_id, o.id) = h.invoice_id AND o.reopened_until IS NOT NULL;
ALTER TABLE history_events ENABLE ALWAYS TRIGGER history_events_append_only;

-- +goose Down
ALTER TABLE history_events DISABLE TRIGGER history_events_append_only;
UPDATE history_events h
SET data = h.data - 'until' || jsonb_build_object('to',
    to_char(to_timestamp(o.reopened_until) AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
FROM invoices o
WHERE h.kind = 'invoice.reopened' AND coalesce(o.main_id, o.id) = h.invoice_id AND o.reopened_until IS NOT NULL;
ALTER TABLE history_events ENABLE ALWAYS TRIGGER history_events_append_only;

DROP VIEW invoices_current;
CREATE VIEW invoices_current AS
SELECT m.id, m.profile_id, m.number, m.title, m.note, m.due_date, m.client_name, m.client_email, m.client_address,
       m.sender_name, m.issuer_name, m.issuer_address, m.issuer_country, m.issuer_tax_id, m.issuer_email, m.created_at,
       m.receive_address AS main_receive_address, m.chosen_id, c.id AS option_id, c.chain_id, c.token_contract,
       c.amount, c.recipient_address, c.factory_address, c.receive_address, c.expires_at, c.settle_deadline,
       c.payment_status, c.settlement_status, c.refund_status, m.return_url, c.canceled_at, m.client_country,
       m.client_tax_id, m.supply_date, m.reference, m.agreed_currency, m.agreed_amount,
       m.agreed_decimals, m.agreed_date, m.pay_token, c.closes_at
FROM invoices m JOIN invoices c ON c.id = coalesce(m.chosen_id, m.id)
WHERE m.main_id IS NULL;
ALTER TABLE invoices DROP COLUMN receiver_deployed_at;
