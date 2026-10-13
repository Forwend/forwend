-- Check status (R-55, D-77): one row per invoice someone asked to check again. checked_at spaces the checks 30 s apart
-- across api replicas; rescan_requested_at asks the worker to look for deposits to the invoice's address again, from
-- rescan_from_block (NULL: the invoice's creation block, found by the worker) in bounded steps; rescanned_at is when
-- the last rescan finished, so money that no log explains (Arc native USDC) does not start a full rescan every time.

-- +goose Up
CREATE TABLE invoice_rechecks (
    invoice_id          text PRIMARY KEY REFERENCES invoices(id),
    checked_at          timestamptz NOT NULL DEFAULT now(),
    rescan_requested_at timestamptz,
    rescan_from_block   bigint CHECK (rescan_from_block >= 0),
    rescanned_at        timestamptz
);
CREATE INDEX invoice_rechecks_rescan ON invoice_rechecks (rescan_requested_at) WHERE rescan_requested_at IS NOT NULL;

-- +goose Down
DROP TABLE invoice_rechecks;
