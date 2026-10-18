-- A withdrawn scope change keeps its Idempotency-Key (R-105), so a late retry of the proposal replays instead of adding
-- the change again. A change gets its invoice only once the client accepts it.

-- +goose Up
CREATE TABLE job_withdrawn_changes (
    job_id uuid NOT NULL REFERENCES jobs (id),
    change_key text NOT NULL CHECK (length(change_key) BETWEEN 1 AND 255),
    change_hash bytea NOT NULL CHECK (length(change_hash) = 32),
    PRIMARY KEY (job_id, change_key)
);
ALTER TABLE job_payments ADD CONSTRAINT job_payments_change_invoiced_accepted
    CHECK (proposed_at IS NULL OR invoice_id IS NULL OR accepted_at IS NOT NULL);

-- +goose Down
ALTER TABLE job_payments DROP CONSTRAINT job_payments_change_invoiced_accepted;
DROP TABLE job_withdrawn_changes;
