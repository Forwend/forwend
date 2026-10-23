-- Owner email (R-80, D-65). login_email is read once from Privy, '' when it has none so it is not read again. Outbox
-- rows are written in the change's transaction, retried with backoff and given up after bounded tries.

-- +goose Up
ALTER TABLE users ADD COLUMN login_email text CHECK (login_email = '' OR char_length(login_email) BETWEEN 3 AND 254);
ALTER TABLE profiles ADD COLUMN email_notifications boolean NOT NULL DEFAULT true;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held'));
ALTER TABLE outbox_events ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outbox_events ADD COLUMN failed_at timestamptz;
DROP INDEX outbox_events_unpublished;
CREATE INDEX outbox_events_due ON outbox_events (next_attempt_at) WHERE published_at IS NULL AND failed_at IS NULL;

-- +goose Down
DROP INDEX outbox_events_due;
CREATE INDEX outbox_events_unpublished ON outbox_events (id) WHERE published_at IS NULL;
ALTER TABLE outbox_events DROP COLUMN failed_at;
ALTER TABLE outbox_events DROP COLUMN next_attempt_at;
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE profiles DROP COLUMN email_notifications;
ALTER TABLE users DROP COLUMN login_email;
