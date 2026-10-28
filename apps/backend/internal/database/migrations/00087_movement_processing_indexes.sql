-- +goose Up
CREATE INDEX chain_transfers_booked_position ON chain_transfers (invoice_id, block_number, log_index)
    WHERE booked;
CREATE INDEX chain_transfers_pending_position ON chain_transfers (invoice_id, block_number, log_index)
    WHERE status = 'confirmed' AND NOT booked;
CREATE INDEX chain_transfers_detected_position ON chain_transfers (invoice_id, block_number, log_index)
    WHERE status = 'detected';
CREATE INDEX receiver_outflows_pending_position ON receiver_outflows (invoice_id, block_number, log_index)
    WHERE ledger_transaction_id IS NULL AND kind <> 'recovery';

-- +goose Down
DROP INDEX receiver_outflows_pending_position;
DROP INDEX chain_transfers_detected_position;
DROP INDEX chain_transfers_pending_position;
DROP INDEX chain_transfers_booked_position;
