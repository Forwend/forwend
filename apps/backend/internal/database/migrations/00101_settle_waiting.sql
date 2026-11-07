-- Paid invoices waiting on the day's sponsored settlements tell their owner, once a day (SEC-03).

-- +goose Up
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder', 'job.change', 'team.invite', 'webhook.disabled', 'settlement.waiting'));
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_waiting
    CHECK (kind <> 'settlement.waiting' OR (invoice_id IS NOT NULL AND user_id IS NULL));

-- +goose Down
DELETE FROM outbox_events WHERE kind = 'settlement.waiting';
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_waiting;
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder', 'job.change', 'team.invite', 'webhook.disabled'));
