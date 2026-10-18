-- Retainers (R-98, D-58): an invoice that repeats every month. request is the create request the later invoices
-- reuse, without the per-month dates; retainer_invoices numbers each month's invoice from 0, the owner's first one,
-- so each month is made once.

-- +goose Up
CREATE TABLE retainers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles (id),
    request jsonb NOT NULL,
    first_due date NOT NULL,
    end_date date CHECK (end_date >= first_due),
    stopped_at timestamptz
);
CREATE INDEX retainers_profile ON retainers (profile_id);
CREATE TABLE retainer_invoices (
    retainer_id uuid NOT NULL REFERENCES retainers (id),
    cycle integer NOT NULL CHECK (cycle >= 0),
    invoice_id text NOT NULL UNIQUE REFERENCES invoices (id),
    PRIMARY KEY (retainer_id, cycle)
);

-- +goose Down
DROP TABLE retainer_invoices;
DROP TABLE retainers;
