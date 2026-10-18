-- A job's payment marked done (R-103): when, and an optional link to the delivered work (D-66: links only). Its invoice
-- is made in the same transaction.

-- +goose Up
ALTER TABLE job_payments
    ADD COLUMN done_at timestamptz,
    ADD COLUMN delivery_link text CHECK (char_length(delivery_link) BETWEEN 9 AND 2000 AND delivery_link LIKE 'https://%'),
    ADD CHECK (delivery_link IS NULL OR done_at IS NOT NULL);

-- +goose Down
ALTER TABLE job_payments DROP COLUMN delivery_link, DROP COLUMN done_at;
