-- R-88: an invoice lists up to 100 lines.

-- +goose Up
-- NOT VALID skips rescanning the table under its lock: every row there already passed the 1-50 check.
ALTER TABLE invoice_lines DROP CONSTRAINT invoice_lines_position_check,
    ADD CONSTRAINT invoice_lines_position_check CHECK (position BETWEEN 1 AND 100) NOT VALID;

-- +goose Down
ALTER TABLE invoice_lines DROP CONSTRAINT invoice_lines_position_check,
    ADD CONSTRAINT invoice_lines_position_check CHECK (position BETWEEN 1 AND 50) NOT VALID;
