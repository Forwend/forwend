-- The bell (R-81) reads this every 15 s per open tab, and outbox rows are never deleted.

-- +goose Up
CREATE INDEX outbox_events_invoice ON outbox_events (invoice_id, id);

-- +goose Down
DROP INDEX outbox_events_invoice;
