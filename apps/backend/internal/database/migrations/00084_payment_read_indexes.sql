-- +goose Up
CREATE INDEX ledger_transactions_transfer_allocations ON ledger_transactions (chain_transfer_id)
    WHERE kind IN ('deposit', 'reopen');
CREATE INDEX invoices_payment_order ON invoices (profile_id, created_at DESC, id DESC)
    WHERE main_id IS NULL;

-- +goose Down
DROP INDEX invoices_payment_order;
DROP INDEX ledger_transactions_transfer_allocations;
