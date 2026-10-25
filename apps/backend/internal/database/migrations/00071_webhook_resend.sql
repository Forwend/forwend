-- Webhook test events and resends (R-149): an owner's test event names no invoice, so it has no history row or
-- sequence, and goes only to the endpoint it was sent to.

-- +goose Up
ALTER TABLE webhook_events ALTER COLUMN history_id DROP NOT NULL, ALTER COLUMN invoice_id DROP NOT NULL,
    ALTER COLUMN sequence DROP NOT NULL,
    -- A test event has none of the three, and every other event has all three, as the NOT NULLs required.
    ADD CONSTRAINT webhook_events_test CHECK (CASE WHEN type = 'webhook.test'
        THEN history_id IS NULL AND invoice_id IS NULL AND sequence IS NULL
        ELSE history_id IS NOT NULL AND invoice_id IS NOT NULL AND sequence IS NOT NULL END);
CREATE INDEX webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, created_at);

-- +goose Down
DROP INDEX webhook_deliveries_endpoint;
ALTER TABLE webhook_events DISABLE TRIGGER webhook_events_append_only;
DELETE FROM webhook_deliveries d USING webhook_events e WHERE e.id = d.event_id AND e.type = 'webhook.test';
DELETE FROM webhook_events WHERE type = 'webhook.test';
ALTER TABLE webhook_events ENABLE ALWAYS TRIGGER webhook_events_append_only;
ALTER TABLE webhook_events DROP CONSTRAINT webhook_events_test, ALTER COLUMN history_id SET NOT NULL,
    ALTER COLUMN invoice_id SET NOT NULL, ALTER COLUMN sequence SET NOT NULL;
