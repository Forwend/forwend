-- Pay page loads per invoice (R-125): a count and two times, never who opened it.

-- +goose Up
CREATE TABLE invoice_views (
    invoice_id text PRIMARY KEY REFERENCES invoices (id),
    first_at timestamptz NOT NULL DEFAULT now(),
    last_at timestamptz NOT NULL DEFAULT now(),
    views bigint NOT NULL DEFAULT 1 CHECK (views > 0)
);

-- +goose Down
DROP TABLE invoice_views;
