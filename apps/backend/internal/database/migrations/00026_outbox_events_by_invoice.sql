-- The bell reads a profile's events newest first (R-81), every 15 s per open tab, and old events are kept: without this
-- index each read scans the whole outbox.

-- +goose Up
CREATE INDEX outbox_events_invoice ON outbox_events (invoice_id, id);

-- +goose Down
DROP INDEX outbox_events_invoice;
