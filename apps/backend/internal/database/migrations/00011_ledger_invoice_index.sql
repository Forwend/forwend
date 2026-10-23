-- For GET /balances (docs/backend/architecture.md#load-test).

-- +goose Up
CREATE INDEX ledger_transactions_invoice ON ledger_transactions (invoice_id);

-- +goose Down
DROP INDEX ledger_transactions_invoice;
