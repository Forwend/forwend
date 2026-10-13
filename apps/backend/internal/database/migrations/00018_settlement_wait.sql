-- Why a pending or sent settlement intent waits, so the invoice API can say it without reading log text (R-54):
-- retry (a temporary condition, tried again at next_attempt_at), cap (the user's sponsored settlements for 24 hours
-- are used up, SEC-03) or unresolved (a sent settle the signer can't resolve yet). NULL: not waiting.

-- +goose Up
ALTER TABLE settlement_intents ADD COLUMN wait text CHECK (wait IN ('retry', 'cap', 'unresolved'));

-- +goose Down
ALTER TABLE settlement_intents DROP COLUMN wait;
