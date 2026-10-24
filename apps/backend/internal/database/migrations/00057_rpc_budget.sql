-- +goose Up
CREATE TABLE rpc_budgets (
    bucket text PRIMARY KEY,
    next_at timestamptz NOT NULL
);

-- +goose Down
DROP TABLE rpc_budgets;
