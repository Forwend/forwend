-- A saved settle not mined settlement.ReplaceAfter after it was signed is signed again with the same nonce and a
-- higher fee (F109). Any one of its versions may be the one mined, so the hashes it replaced are kept.

-- +goose Up
ALTER TABLE settlement_intents ADD COLUMN replaced_hashes text[] NOT NULL DEFAULT '{}';
ALTER TABLE settlement_intents ADD COLUMN signed_at timestamptz;

-- +goose Down
ALTER TABLE settlement_intents DROP COLUMN signed_at;
ALTER TABLE settlement_intents DROP COLUMN replaced_hashes;
