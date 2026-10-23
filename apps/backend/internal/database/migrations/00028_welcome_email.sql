-- Welcome email (R-84): accounts made before this migration keep welcome false and never get one.

-- +goose Up
ALTER TABLE users ADD COLUMN welcome boolean NOT NULL DEFAULT false;
ALTER TABLE outbox_events ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome'));
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_subject
    CHECK ((kind = 'account.welcome') = (user_id IS NOT NULL AND invoice_id IS NULL));
CREATE UNIQUE INDEX outbox_events_one_welcome ON outbox_events (user_id) WHERE kind = 'account.welcome';

-- +goose Down
DROP INDEX outbox_events_one_welcome;
DELETE FROM outbox_events WHERE kind = 'account.welcome';
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_subject;
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt'));
ALTER TABLE outbox_events DROP COLUMN user_id;
ALTER TABLE users DROP COLUMN welcome;
