-- The client email cap (R-116) counts the last 24 hours on every client email; outbox rows are never deleted.

-- +goose Up
CREATE INDEX outbox_events_client_recent ON outbox_events (created_at)
    WHERE kind IN ('invoice.sent', 'invoice.reminder', 'job.change');

-- +goose Down
DROP INDEX outbox_events_client_recent;
