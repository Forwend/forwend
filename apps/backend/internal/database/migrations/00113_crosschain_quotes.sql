-- Cross-chain payments through NEAR Intents 1Click (D-123). The worker keeps 1Click's token list; each quote a payer
-- asked for is kept exactly as 1Click signed it (D-124), for the payer's page, the worker and disputes.
-- +goose Up
CREATE TABLE intents_tokens (
    asset_id text PRIMARY KEY CHECK (length(asset_id) BETWEEN 1 AND 200),
    blockchain text NOT NULL CHECK (blockchain ~ '^[a-z0-9_-]{1,32}$'),
    symbol text NOT NULL CHECK (length(symbol) BETWEEN 1 AND 32),
    decimals integer NOT NULL CHECK (decimals BETWEEN 0 AND 36),
    contract text CHECK (length(contract) <= 200),
    usd numeric CHECK (usd > 0 AND usd < 1e9), -- null without a price
    fetched_at timestamptz NOT NULL
);

CREATE TABLE crosschain_quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id text NOT NULL REFERENCES invoices (id),
    -- The Base USDC option the USDC goes to: its receive address is the quote's recipient.
    option_id text NOT NULL REFERENCES invoices (id),
    origin_asset text NOT NULL,
    refund_to text NOT NULL CHECK (length(refund_to) BETWEEN 1 AND 200),
    deposit_address text NOT NULL UNIQUE CHECK (length(deposit_address) BETWEEN 1 AND 200),
    amount_in uint256 NOT NULL CHECK (amount_in > 0),
    min_amount_in uint256 NOT NULL CHECK (min_amount_in > 0 AND min_amount_in <= amount_in),
    amount_out uint256 NOT NULL CHECK (amount_out > 0),
    time_estimate integer NOT NULL CHECK (time_estimate >= 0),
    -- The page holds the price until shown_until; 1Click refunds what hasn't converted by deadline (D-125).
    shown_until timestamptz NOT NULL,
    deadline timestamptz NOT NULL CHECK (deadline >= shown_until),
    -- 1Click's answer byte for byte: its signature covers this text, not a parsed copy.
    signed text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING_DEPOSIT' CHECK (status IN ('PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX',
        'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crosschain_quotes_invoice ON crosschain_quotes (invoice_id, created_at);

-- +goose Down
DROP TABLE crosschain_quotes;
DROP TABLE intents_tokens;
