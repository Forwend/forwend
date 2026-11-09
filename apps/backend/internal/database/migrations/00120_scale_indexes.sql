-- CONCURRENTLY: building them does not block invoice writes on a live database; it can run only outside a
-- transaction.
-- A failed concurrent build leaves an invalid index: each one is dropped first, so a re-run builds it again.
-- +goose NO TRANSACTION
-- +goose Up
-- An invoice's rows: every coalesce(main_id, id) lookup.
DROP INDEX CONCURRENTLY IF EXISTS invoices_group;
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_group ON invoices ((coalesce(main_id, id)));
-- The ledger round's open invoices.
DROP INDEX CONCURRENTLY IF EXISTS invoices_chain_open;
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_chain_open ON invoices (chain_id) WHERE payment_status IN ('open', 'detected', 'partially_paid');
-- The watcher's watch list: invoices within the watch window.
DROP INDEX CONCURRENTLY IF EXISTS invoices_chain_watch;
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_chain_watch ON invoices (chain_id, settle_deadline);
-- Invoices that can still owe or hold money (ledger.MayHoldMoneySQL): balances and the watcher's old receivers.
DROP INDEX CONCURRENTLY IF EXISTS invoices_money_profile;
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_money_profile ON invoices (profile_id)
    WHERE refund_status IN ('held', 'refund_pending') OR settlement_status <> 'settled' AND payment_status <> 'expired';
DROP INDEX CONCURRENTLY IF EXISTS invoices_money_chain;
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_money_chain ON invoices (chain_id, settle_deadline)
    WHERE refund_status IN ('held', 'refund_pending') OR settlement_status <> 'settled' AND payment_status <> 'expired';
-- The create caps count only open and recent invoices.
DROP INDEX CONCURRENTLY IF EXISTS invoices_profile_closes;
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_profile_closes ON invoices (profile_id, closes_at);
DROP INDEX CONCURRENTLY IF EXISTS invoices_profile_created;
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_profile_created ON invoices (profile_id, created_at);
-- The Payments "Needs attention" list's problem sets.
DROP INDEX CONCURRENTLY IF EXISTS webhook_deliveries_failed;
CREATE INDEX CONCURRENTLY IF NOT EXISTS webhook_deliveries_failed ON webhook_deliveries (event_id) WHERE status = 'failed';
DROP INDEX CONCURRENTLY IF EXISTS settlement_intents_open;
CREATE INDEX CONCURRENTLY IF NOT EXISTS settlement_intents_open ON settlement_intents (invoice_id) WHERE status <> 'confirmed';

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS settlement_intents_open;
DROP INDEX CONCURRENTLY IF EXISTS webhook_deliveries_failed;
DROP INDEX CONCURRENTLY IF EXISTS invoices_profile_created;
DROP INDEX CONCURRENTLY IF EXISTS invoices_profile_closes;
DROP INDEX CONCURRENTLY IF EXISTS invoices_money_chain;
DROP INDEX CONCURRENTLY IF EXISTS invoices_money_profile;
DROP INDEX CONCURRENTLY IF EXISTS invoices_chain_watch;
DROP INDEX CONCURRENTLY IF EXISTS invoices_chain_open;
DROP INDEX CONCURRENTLY IF EXISTS invoices_group;
