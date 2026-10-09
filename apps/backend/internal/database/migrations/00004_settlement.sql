-- Settlement (R-22): refused intents, what the signer needs to reconcile after a crash, one settlement per invoice.

-- +goose Up
-- The signed settle transaction is saved before it is broadcast: after a crash the same bytes (same hash, same
-- nonce) are sent again, never a second settle.
ALTER TABLE settlement_intents ADD COLUMN sender text CHECK (sender ~ '^0x[0-9a-f]{40}$');
ALTER TABLE settlement_intents ADD COLUMN raw_tx bytea;
ALTER TABLE settlement_intents ADD COLUMN reason text;
-- refused: a check failed and nothing was sent; reason says which.
ALTER TABLE settlement_intents DROP CONSTRAINT settlement_intents_status_check;
ALTER TABLE settlement_intents ADD CONSTRAINT settlement_intents_status_check
    CHECK (status IN ('pending', 'sent', 'confirmed', 'refused'));
ALTER TABLE settlement_intents DROP CONSTRAINT settlement_intents_check;
ALTER TABLE settlement_intents ADD CONSTRAINT settlement_intents_sent_check
    CHECK (status IN ('pending', 'refused') OR (tx_hash IS NOT NULL AND nonce IS NOT NULL AND raw_tx IS NOT NULL));
CREATE UNIQUE INDEX ledger_transactions_one_settlement ON ledger_transactions (invoice_id) WHERE kind = 'settlement';

-- +goose Down
DROP INDEX ledger_transactions_one_settlement;
ALTER TABLE settlement_intents DROP CONSTRAINT settlement_intents_sent_check;
ALTER TABLE settlement_intents DROP COLUMN reason;
ALTER TABLE settlement_intents DROP COLUMN raw_tx;
ALTER TABLE settlement_intents DROP COLUMN sender;
ALTER TABLE settlement_intents ADD CONSTRAINT settlement_intents_check CHECK (status = 'pending' OR tx_hash IS NOT NULL);
ALTER TABLE settlement_intents DROP CONSTRAINT settlement_intents_status_check;
ALTER TABLE settlement_intents ADD CONSTRAINT settlement_intents_status_check
    CHECK (status IN ('pending', 'sent', 'confirmed', 'failed'));
