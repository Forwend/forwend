-- Payer receipt email (R-82, D-68): on the main row, for the receipt only, and deleted with the invoice.

-- +goose Up
ALTER TABLE invoices ADD COLUMN payer_email text CHECK (char_length(payer_email) BETWEEN 3 AND 254);
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt'));
CREATE UNIQUE INDEX outbox_events_one_receipt ON outbox_events (invoice_id) WHERE kind = 'invoice.receipt';

-- +goose Down
DROP INDEX outbox_events_one_receipt;
DELETE FROM outbox_events WHERE kind = 'invoice.receipt';
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held'));
ALTER TABLE invoices DROP COLUMN payer_email;
