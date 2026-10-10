-- GET /balances sums a profile's ledger entries through ledger_transactions.invoice_id. Without an index on it, each
-- request read the whole table: 21 ms at 50,000 invoices, growing with every invoice (docs/backend/architecture.md#load-test).

-- +goose Up
CREATE INDEX ledger_transactions_invoice ON ledger_transactions (invoice_id);

-- +goose Down
DROP INDEX ledger_transactions_invoice;
