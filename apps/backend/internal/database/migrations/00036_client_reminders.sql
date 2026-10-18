-- A saved client can start its new invoices with payment reminders on (R-97). Off unless the owner says so (D-69).

-- +goose Up
ALTER TABLE clients ADD COLUMN reminders boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE clients DROP COLUMN reminders;
