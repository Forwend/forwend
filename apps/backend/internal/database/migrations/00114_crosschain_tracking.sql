-- What 1Click says happened to each cross-chain quote (R-234): the worker reads its status until it ends, and every
-- reader shows what the payer paid with (R-235). The token is kept as quoted, since 1Click's list may drop it.
-- +goose Up
ALTER TABLE crosschain_quotes
    ADD COLUMN origin_blockchain text NOT NULL DEFAULT '' CHECK (origin_blockchain ~ '^[a-z0-9_-]{0,32}$'),
    ADD COLUMN origin_symbol text NOT NULL DEFAULT '' CHECK (length(origin_symbol) <= 32),
    ADD COLUMN origin_decimals integer NOT NULL DEFAULT 0 CHECK (origin_decimals BETWEEN 0 AND 36),
    -- null once the worker stops reading it
    ADD COLUMN next_check_at timestamptz DEFAULT now(),
    ADD COLUMN deposited_amount numeric(78, 0) CHECK (deposited_amount >= 0),
    ADD COLUMN delivered_amount numeric(78, 0) CHECK (delivered_amount >= 0),
    ADD COLUMN refunded_amount numeric(78, 0) CHECK (refunded_amount >= 0),
    ADD COLUMN refund_reason text CHECK (length(refund_reason) <= 64),
    -- [{"hash": ..., "explorerUrl": ...}] as 1Click gives them, explorer links https only
    ADD COLUMN origin_txs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(origin_txs) = 'array'),
    ADD COLUMN destination_txs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(destination_txs) = 'array'),
    ADD COLUMN deposit_seen_at timestamptz,
    ADD COLUMN converted_at timestamptz;
UPDATE crosschain_quotes q SET origin_blockchain = t.blockchain, origin_symbol = t.symbol, origin_decimals = t.decimals
FROM intents_tokens t WHERE t.asset_id = q.origin_asset;
CREATE INDEX crosschain_quotes_due ON crosschain_quotes (next_check_at) WHERE next_check_at IS NOT NULL;
-- Exports find a Base transfer's quote by its option.
CREATE INDEX crosschain_quotes_option ON crosschain_quotes (option_id);

-- +goose Down
DROP INDEX crosschain_quotes_option;
DROP INDEX crosschain_quotes_due;
ALTER TABLE crosschain_quotes DROP COLUMN origin_blockchain, DROP COLUMN origin_symbol, DROP COLUMN origin_decimals,
    DROP COLUMN next_check_at, DROP COLUMN deposited_amount, DROP COLUMN delivered_amount, DROP COLUMN refunded_amount,
    DROP COLUMN refund_reason, DROP COLUMN origin_txs, DROP COLUMN destination_txs, DROP COLUMN deposit_seen_at,
    DROP COLUMN converted_at;
