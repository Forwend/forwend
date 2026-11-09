-- R-240: a profile can turn payments from other chains through NEAR Intents off; on by default. An open quote still
-- finishes: the switch stops new quotes only.
-- +goose Up
ALTER TABLE profiles ADD COLUMN crosschain_off boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE profiles DROP COLUMN crosschain_off;
