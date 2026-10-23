-- New invoices for this client start with payment reminders on (R-97, D-69).

-- +goose Up
ALTER TABLE clients ADD COLUMN reminders boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE clients DROP COLUMN reminders;
