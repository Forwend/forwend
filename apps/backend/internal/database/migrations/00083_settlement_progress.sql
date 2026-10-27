-- +goose Up
ALTER TABLE settlement_intents
    ADD COLUMN receipt_tx_hash text,
    ADD COLUMN receipt_block bigint CHECK (receipt_block >= 0),
    ADD COLUMN receipt_time bigint CHECK (receipt_time >= 0),
    ADD CONSTRAINT settlement_receipt_complete CHECK (
        (receipt_tx_hash IS NULL AND receipt_block IS NULL AND receipt_time IS NULL)
        OR (receipt_tx_hash IS NOT NULL AND receipt_block IS NOT NULL AND receipt_time IS NOT NULL)
    );

-- +goose Down
ALTER TABLE settlement_intents
    DROP CONSTRAINT settlement_receipt_complete,
    DROP COLUMN receipt_tx_hash,
    DROP COLUMN receipt_block,
    DROP COLUMN receipt_time;
