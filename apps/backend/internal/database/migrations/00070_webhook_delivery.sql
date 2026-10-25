-- Webhook delivery (R-148, D-42): cmd/webhooks sends each delivery and retries it on a schedule; every attempt is
-- logged. An endpoint that answers 410 or fails a delivery's last attempt is turned off, and its owner gets an email.

-- +goose Up
ALTER TABLE webhook_deliveries
    ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
    ADD COLUMN attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
    -- The body as first sent: every retry sends the same bytes.
    ADD COLUMN body text,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';

CREATE TABLE webhook_attempts (
    id bigserial PRIMARY KEY,
    endpoint_id uuid NOT NULL,
    event_id text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    status_code integer, -- null when no answer came
    error text CHECK (length(error) <= 300),
    duration_ms integer NOT NULL,
    FOREIGN KEY (endpoint_id, event_id) REFERENCES webhook_deliveries (endpoint_id, event_id) ON DELETE CASCADE
);
CREATE INDEX webhook_attempts_delivery ON webhook_attempts (endpoint_id, event_id, id);

ALTER TABLE outbox_events ADD COLUMN endpoint_id uuid REFERENCES webhook_endpoints (id) ON DELETE CASCADE;
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder', 'job.change', 'team.invite', 'webhook.disabled'));
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_endpoint
    CHECK ((kind = 'webhook.disabled') =
           (endpoint_id IS NOT NULL AND invoice_id IS NULL AND user_id IS NULL AND job_id IS NULL AND invite_id IS NULL));

-- +goose Down
DELETE FROM outbox_events WHERE kind = 'webhook.disabled';
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_endpoint;
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder', 'job.change', 'team.invite'));
ALTER TABLE outbox_events DROP COLUMN endpoint_id;
DROP TABLE webhook_attempts;
ALTER TABLE webhook_deliveries DROP COLUMN status, DROP COLUMN attempts, DROP COLUMN next_attempt_at, DROP COLUMN body,
    DROP COLUMN updated_at;
