-- Scope change email (R-107): when the owner proposes a change, the client who accepted the quote gets an email with
-- the job's link. The outbox row names the job, and its payload the change's key.

-- +goose Up
ALTER TABLE outbox_events ADD COLUMN job_id uuid REFERENCES jobs (id);
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder', 'job.change'));
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_job
    CHECK ((kind = 'job.change') = (job_id IS NOT NULL AND invoice_id IS NULL AND user_id IS NULL));
CREATE INDEX outbox_events_by_job ON outbox_events (job_id, created_at) WHERE job_id IS NOT NULL;

-- +goose Down
DROP INDEX outbox_events_by_job;
DELETE FROM outbox_events WHERE kind = 'job.change';
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_job;
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder'));
ALTER TABLE outbox_events DROP COLUMN job_id;
