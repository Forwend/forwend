-- The client email cap (R-116) counts a user's emails to clients of the last 24 hours on every Send to client, job
-- change, retainer month and reminders round; outbox rows are never deleted, so this keeps the count off the whole table.

-- +goose Up
CREATE INDEX outbox_events_client_recent ON outbox_events (created_at)
    WHERE kind IN ('invoice.sent', 'invoice.reminder', 'job.change');

-- +goose Down
DROP INDEX outbox_events_client_recent;
