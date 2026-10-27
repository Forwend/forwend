-- +goose Up
ALTER TABLE invoice_rechecks ADD COLUMN rescan_retry_at timestamptz;

-- +goose Down
ALTER TABLE invoice_rechecks DROP COLUMN rescan_retry_at;
