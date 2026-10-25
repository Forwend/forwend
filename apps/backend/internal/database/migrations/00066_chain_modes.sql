-- Test mode is the testnets and live mode the mainnets (D-87, R-143). A chain is test mode unless whatever adds it
-- says live: testnet money must never pass for real money.

-- +goose Up
ALTER TABLE chains ADD COLUMN livemode boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE chains DROP COLUMN livemode;
