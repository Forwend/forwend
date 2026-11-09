-- Why an invoice's balance alert exists (R-120): excess is true when the chain holds more than booked, a deposit the
-- scan missed. A refund of that invoice waits while it is true, so it can't take another payer's booked money.
-- +goose Up
ALTER TABLE invoice_balance_alerts ADD COLUMN excess boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE invoice_balance_alerts DROP COLUMN excess;
