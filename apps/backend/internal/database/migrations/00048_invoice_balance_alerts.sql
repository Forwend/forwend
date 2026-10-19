-- An expired invoice whose receive address holds money the ledger can't explain (R-120): how many times the worker found
-- that, and when it reads the balance again. The wait doubles, so such invoices can't use up a chain's round.

-- +goose Up
CREATE TABLE invoice_balance_alerts (
    invoice_id text PRIMARY KEY REFERENCES invoices (id),
    alerts integer NOT NULL CHECK (alerts > 0),
    next_check_at timestamptz NOT NULL
);

-- +goose Down
DROP TABLE invoice_balance_alerts;
