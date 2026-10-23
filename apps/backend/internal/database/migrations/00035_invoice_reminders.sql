-- Payment reminders (R-96, D-69): the client stops them with a link carrying stop_token. A row exists once the
-- owner first turns them on.

-- +goose Up
CREATE TABLE invoice_reminders (
    invoice_id text PRIMARY KEY REFERENCES invoices (id),
    enabled boolean NOT NULL,
    stop_token text NOT NULL UNIQUE CHECK (stop_token ~ '^[0-9a-f]{64}$'),
    stopped_at timestamptz
);
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder'));
CREATE UNIQUE INDEX outbox_events_one_reminder_step ON outbox_events (invoice_id, (payload->>'step'))
    WHERE kind = 'invoice.reminder';

-- +goose Down
DROP INDEX outbox_events_one_reminder_step;
DELETE FROM outbox_events WHERE kind = 'invoice.reminder';
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent'));
DROP TABLE invoice_reminders;
