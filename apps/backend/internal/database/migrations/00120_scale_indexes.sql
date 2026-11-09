-- +goose Up
-- An invoice's rows: every coalesce(main_id, id) lookup.
CREATE INDEX invoices_group ON invoices ((coalesce(main_id, id)));
-- The ledger round's open invoices.
CREATE INDEX invoices_chain_open ON invoices (chain_id) WHERE payment_status IN ('open', 'detected', 'partially_paid');
-- The watcher's watch list: invoices within the watch window.
CREATE INDEX invoices_chain_watch ON invoices (chain_id, settle_deadline);
-- Invoices that can still owe or hold money (ledger.MayHoldMoneySQL): balances and the watcher's old receivers.
CREATE INDEX invoices_money_profile ON invoices (profile_id)
    WHERE refund_status IN ('held', 'refund_pending') OR settlement_status <> 'settled' AND payment_status <> 'expired';
CREATE INDEX invoices_money_chain ON invoices (chain_id, settle_deadline)
    WHERE refund_status IN ('held', 'refund_pending') OR settlement_status <> 'settled' AND payment_status <> 'expired';
-- The create caps count only open and recent invoices.
CREATE INDEX invoices_profile_closes ON invoices (profile_id, closes_at);
CREATE INDEX invoices_profile_created ON invoices (profile_id, created_at);
-- The Payments "Needs attention" list's problem sets.
CREATE INDEX webhook_deliveries_failed ON webhook_deliveries (event_id) WHERE status = 'failed';
CREATE INDEX settlement_intents_open ON settlement_intents (invoice_id) WHERE status <> 'confirmed';

-- +goose Down
DROP INDEX settlement_intents_open;
DROP INDEX webhook_deliveries_failed;
DROP INDEX invoices_profile_created;
DROP INDEX invoices_profile_closes;
DROP INDEX invoices_money_chain;
DROP INDEX invoices_money_profile;
DROP INDEX invoices_chain_watch;
DROP INDEX invoices_chain_open;
DROP INDEX invoices_group;
