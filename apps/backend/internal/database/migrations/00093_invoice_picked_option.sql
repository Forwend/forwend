-- R-57: the option a payer picked on a payer-chooses invoice, on its main row, so the pay link opens on it again.
-- It only shows the pick: the first money still decides the invoice's option (R-56).
-- +goose Up
ALTER TABLE invoices ADD COLUMN picked_id text REFERENCES invoices (id);

-- +goose Down
ALTER TABLE invoices DROP COLUMN picked_id;
