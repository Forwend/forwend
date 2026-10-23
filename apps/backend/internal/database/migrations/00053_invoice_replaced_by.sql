-- Revise (R-129): a canceled invoice names the invoice that replaces it.

-- +goose Up
ALTER TABLE invoices ADD COLUMN replaced_by text REFERENCES invoices (id) CHECK (replaced_by <> id);
-- The owner's read looks it up from the new invoice, and one invoice replaces at most one.
CREATE UNIQUE INDEX invoices_replaced_by ON invoices (replaced_by) WHERE replaced_by IS NOT NULL;

-- +goose Down
ALTER TABLE invoices DROP COLUMN replaced_by;
