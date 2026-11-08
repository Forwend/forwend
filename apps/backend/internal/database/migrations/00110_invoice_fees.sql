-- Each invoice option's fees, part of its contract terms (R-226, D-122). Settlement pays the network fee to the settler
-- and the platform fee to the refund authority; each is booked as its own kind (R-230).
-- +goose Up
ALTER TABLE invoices ADD COLUMN network_fee uint256 NOT NULL DEFAULT 0,
    ADD COLUMN platform_fee uint256 NOT NULL DEFAULT 0,
    -- The contract's own ceiling (feesWithinCeiling): terms past it never settle.
    ADD CONSTRAINT invoices_fees_ceiling CHECK (network_fee + platform_fee <= div(amount, 10));

-- +goose StatementBegin
CREATE FUNCTION invoices_fees_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'invoice % terms never change', OLD.id;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER invoices_fees_fixed BEFORE UPDATE ON invoices FOR EACH ROW
    WHEN (NEW.network_fee IS DISTINCT FROM OLD.network_fee OR NEW.platform_fee IS DISTINCT FROM OLD.platform_fee)
    EXECUTE FUNCTION invoices_fees_fixed();
ALTER TABLE invoices ENABLE ALWAYS TRIGGER invoices_fees_fixed;

-- FeesPaid is one event for both fees, so its two outflows share the event's position.
ALTER TABLE receiver_outflows DROP CONSTRAINT receiver_outflows_kind_check,
    ADD CONSTRAINT receiver_outflows_kind_check
        CHECK (kind IN ('settlement', 'refund', 'recovery', 'network_fee', 'platform_fee')),
    DROP CONSTRAINT receiver_outflows_chain_id_block_hash_log_index_key,
    ADD CONSTRAINT receiver_outflows_chain_id_block_hash_log_index_key UNIQUE (chain_id, block_hash, log_index, kind),
    DROP CONSTRAINT receiver_outflows_chain_id_tx_hash_log_index_key,
    ADD CONSTRAINT receiver_outflows_chain_id_tx_hash_log_index_key UNIQUE (chain_id, tx_hash, log_index, kind);

ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check,
    ADD CONSTRAINT ledger_transactions_kind_check CHECK (kind IN ('deposit', 'settlement', 'refund', 'reversal', 'expiry',
        'reopen', 'network_fee', 'platform_fee'));
CREATE UNIQUE INDEX ledger_transactions_one_network_fee ON ledger_transactions (invoice_id) WHERE kind = 'network_fee';
CREATE UNIQUE INDEX ledger_transactions_one_platform_fee ON ledger_transactions (invoice_id) WHERE kind = 'platform_fee';

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM invoices WHERE network_fee > 0 OR platform_fee > 0) THEN
        RAISE EXCEPTION 'can''t roll back: invoices carry fees in their contract terms';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP INDEX ledger_transactions_one_platform_fee;
DROP INDEX ledger_transactions_one_network_fee;
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check,
    ADD CONSTRAINT ledger_transactions_kind_check
        CHECK (kind IN ('deposit', 'settlement', 'refund', 'reversal', 'expiry', 'reopen'));
ALTER TABLE receiver_outflows DROP CONSTRAINT receiver_outflows_chain_id_tx_hash_log_index_key,
    ADD CONSTRAINT receiver_outflows_chain_id_tx_hash_log_index_key UNIQUE (chain_id, tx_hash, log_index),
    DROP CONSTRAINT receiver_outflows_chain_id_block_hash_log_index_key,
    ADD CONSTRAINT receiver_outflows_chain_id_block_hash_log_index_key UNIQUE (chain_id, block_hash, log_index),
    DROP CONSTRAINT receiver_outflows_kind_check,
    ADD CONSTRAINT receiver_outflows_kind_check CHECK (kind IN ('settlement', 'refund', 'recovery'));
DROP TRIGGER invoices_fees_fixed ON invoices;
DROP FUNCTION invoices_fees_fixed();
ALTER TABLE invoices DROP CONSTRAINT invoices_fees_ceiling, DROP COLUMN platform_fee, DROP COLUMN network_fee;
