-- Webhook events (R-147, D-42): history.Add writes one for each invoice change an event type names, in the change's
-- transaction, and a delivery for each endpoint that takes it then. Append-only, like the history row it comes from.

-- +goose Up
CREATE TABLE webhook_events (
    id text PRIMARY KEY DEFAULT 'evt_' || replace(gen_random_uuid()::text, '-', ''),
    -- No foreign key: history rows are never removed, and one would stop TRUNCATE before history's own guard does.
    history_id bigint NOT NULL UNIQUE,
    profile_id uuid NOT NULL REFERENCES profiles (id),
    invoice_id text NOT NULL REFERENCES invoices (id), -- the main row, as in history_events
    type text NOT NULL CHECK (type ~ '^[a-z]+\.[a-z_]+$'),
    livemode boolean NOT NULL,
    -- The invoice's events in commit order, from 1: its writers lock its rows first, and the key stops one that doesn't.
    sequence integer NOT NULL CHECK (sequence > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (invoice_id, sequence)
);
CREATE TRIGGER webhook_events_append_only BEFORE UPDATE OR DELETE ON webhook_events
    FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER webhook_events_no_truncate BEFORE TRUNCATE ON webhook_events
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
ALTER TABLE webhook_events ENABLE ALWAYS TRIGGER webhook_events_append_only;
ALTER TABLE webhook_events ENABLE ALWAYS TRIGGER webhook_events_no_truncate;

CREATE TABLE webhook_deliveries (
    endpoint_id uuid NOT NULL REFERENCES webhook_endpoints (id) ON DELETE CASCADE,
    event_id text NOT NULL REFERENCES webhook_events (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (endpoint_id, event_id)
);

-- +goose Down
DROP TABLE webhook_deliveries;
DROP TABLE webhook_events;
