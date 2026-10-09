-- A receiver settled outside our signer (e.g. by the refund authority after the deadline) is confirmed without a
-- saved transaction: the sent fields are required only while an intent is sent (R-30).

-- +goose Up
ALTER TABLE settlement_intents DROP CONSTRAINT settlement_intents_sent_check;
ALTER TABLE settlement_intents ADD CONSTRAINT settlement_intents_sent_check
    CHECK (status <> 'sent' OR (tx_hash IS NOT NULL AND nonce IS NOT NULL AND raw_tx IS NOT NULL));

-- +goose Down
ALTER TABLE settlement_intents DROP CONSTRAINT settlement_intents_sent_check;
ALTER TABLE settlement_intents ADD CONSTRAINT settlement_intents_sent_check
    CHECK (status IN ('pending', 'refused') OR (tx_hash IS NOT NULL AND nonce IS NOT NULL AND raw_tx IS NOT NULL));
