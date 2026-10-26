-- +goose Up
ALTER TABLE payment_links ADD COLUMN livemode boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE payment_links DROP COLUMN livemode;
