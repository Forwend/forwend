-- A retainer month that can't be made waits retry_at, longer after each failure in a row, and the owner is told once
-- (R-98). A webhook claim reads each endpoint's first due delivery from its own index, not the whole backlog.
-- CONCURRENTLY builds the index without blocking webhook writes; it runs only outside a transaction, so each
-- statement can run again after a failed run.
-- +goose NO TRANSACTION
-- +goose Up
ALTER TABLE retainers ADD COLUMN IF NOT EXISTS failures integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS retry_at timestamptz;
ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder', 'job.change', 'team.invite', 'webhook.disabled', 'settlement.waiting',
                    'wallet.outflow', 'retainer.failed'));
DROP INDEX CONCURRENTLY IF EXISTS webhook_deliveries_endpoint_due;
CREATE INDEX CONCURRENTLY IF NOT EXISTS webhook_deliveries_endpoint_due
    ON webhook_deliveries (endpoint_id, next_attempt_at, event_id) WHERE status = 'pending';

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS webhook_deliveries_endpoint_due;
DELETE FROM outbox_events WHERE kind = 'retainer.failed';
ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder', 'job.change', 'team.invite', 'webhook.disabled', 'settlement.waiting',
                    'wallet.outflow'));
ALTER TABLE retainers DROP COLUMN IF EXISTS failures, DROP COLUMN IF EXISTS retry_at;
