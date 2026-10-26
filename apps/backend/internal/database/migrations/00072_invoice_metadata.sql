-- Invoice metadata (R-151, D-101): the creator's own keys and values, set at create on the main row only.

-- +goose Up
ALTER TABLE invoices ADD COLUMN metadata jsonb CHECK (jsonb_typeof(metadata) = 'object');

-- +goose Down
ALTER TABLE invoices DROP COLUMN metadata;
