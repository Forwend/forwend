-- Retainers (R-98, D-58): request is the create request each month reuses, without the per-month dates. cycle 0
-- is the owner's first invoice, and the primary key makes each month once.

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
