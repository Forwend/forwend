-- Scope changes (R-105): a payment the owner adds to an accepted job, which the client accepts by the job's link like
-- the quote. proposed_at marks a change; change_key and change_hash make the owner's request idempotent per job. The
-- client's typed name, email and time are kept on the change.

-- +goose Up
ALTER TABLE job_payments
    ADD COLUMN proposed_at timestamptz,
    ADD COLUMN change_key text CHECK (length(change_key) BETWEEN 1 AND 255),
    ADD COLUMN change_hash bytea CHECK (length(change_hash) = 32),
    ADD COLUMN accepted_name text CHECK (char_length(accepted_name) BETWEEN 1 AND 200),
    ADD COLUMN accepted_email text CHECK (char_length(accepted_email) BETWEEN 1 AND 254),
    ADD COLUMN accepted_at timestamptz,
    ADD CHECK ((proposed_at IS NULL) = (change_key IS NULL) AND (change_key IS NULL) = (change_hash IS NULL)),
    ADD CHECK ((accepted_at IS NULL) = (accepted_name IS NULL) AND (accepted_name IS NULL) = (accepted_email IS NULL)),
    ADD CHECK (accepted_at IS NULL OR proposed_at IS NOT NULL),
    ADD CHECK (proposed_at IS NULL OR NOT on_accept);
CREATE UNIQUE INDEX job_payments_change_key ON job_payments (job_id, change_key) WHERE change_key IS NOT NULL;

-- +goose Down
DROP INDEX job_payments_change_key;
DELETE FROM job_payments WHERE proposed_at IS NOT NULL;
ALTER TABLE job_payments DROP COLUMN accepted_at, DROP COLUMN accepted_email, DROP COLUMN accepted_name,
    DROP COLUMN change_hash, DROP COLUMN change_key, DROP COLUMN proposed_at;
