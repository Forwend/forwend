-- Send to client (R-94): the owner emails an open invoice to its client's address. Each send is an outbox row on the
-- invoice's main row, with the request's Idempotency-Key, so a retry queues no second email.

-- +goose Up
ALTER TABLE outbox_events ADD COLUMN idempotency_key text CHECK (length(idempotency_key) BETWEEN 1 AND 255);
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent'));
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_send_key CHECK ((kind = 'invoice.sent') = (idempotency_key IS NOT NULL));
CREATE UNIQUE INDEX outbox_events_send_once ON outbox_events (invoice_id, idempotency_key) WHERE kind = 'invoice.sent';

-- +goose Down
DROP INDEX outbox_events_send_once;
DELETE FROM outbox_events WHERE kind = 'invoice.sent';
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_send_key;
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome'));
ALTER TABLE outbox_events DROP COLUMN idempotency_key;
