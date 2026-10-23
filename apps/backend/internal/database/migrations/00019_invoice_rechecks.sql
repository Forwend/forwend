-- Check status (R-55, D-77). checked_at spaces checks across api replicas (invoice.RecheckEvery); a NULL
-- rescan_from_block is the creation block; rescanned_at stops money no log explains (Arc USDC) rescanning each time.

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
