-- +goose Up
ALTER TABLE receiver_scans ADD COLUMN failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0);
CREATE INDEX receiver_scans_due ON receiver_scans (legacy, next_at, invoice_id);

-- +goose Down
DROP INDEX receiver_scans_due;
ALTER TABLE receiver_scans DROP COLUMN failures;
