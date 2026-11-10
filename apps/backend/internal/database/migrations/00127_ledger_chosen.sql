-- D-76: once a payer-chooses invoice's option is chosen, the held part of each of its on-time deposits booked while
-- nothing was chosen goes to the creator. It names its deposit, once, as a reopen does, but needs no expiry.
-- NOT VALID skips rescanning the ledger under its lock: every row there already passes these checks. The index is built
-- CONCURRENTLY, outside a transaction, and dropped first so a failed build is built again. The down step fails once a
-- chosen row exists, as earlier kind changes do.
-- +goose NO TRANSACTION
-- +goose Up
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check,
    ADD CONSTRAINT ledger_transactions_kind_check CHECK (kind IN ('deposit', 'settlement', 'refund', 'reversal', 'expiry',
        'reopen', 'network_fee', 'platform_fee', 'chosen')) NOT VALID;
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_check,
    ADD CONSTRAINT ledger_transactions_check
        CHECK (kind IN ('reopen', 'chosen') OR (kind = 'deposit') = (chain_transfer_id IS NOT NULL)) NOT VALID;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_chosen_names_deposit
    CHECK (kind <> 'chosen' OR chain_transfer_id IS NOT NULL) NOT VALID;
DROP INDEX CONCURRENTLY IF EXISTS ledger_transactions_one_chosen;
CREATE UNIQUE INDEX CONCURRENTLY ledger_transactions_one_chosen ON ledger_transactions (chain_transfer_id)
    WHERE kind = 'chosen';

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS ledger_transactions_one_chosen;
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_chosen_names_deposit;
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_check,
    ADD CONSTRAINT ledger_transactions_check CHECK (kind = 'reopen' OR (kind = 'deposit') = (chain_transfer_id IS NOT NULL));
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check,
    ADD CONSTRAINT ledger_transactions_kind_check CHECK (kind IN ('deposit', 'settlement', 'refund', 'reversal', 'expiry',
        'reopen', 'network_fee', 'platform_fee'));
