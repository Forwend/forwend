-- +goose Up
CREATE TABLE webhook_delivery_profiles (
    profile_id uuid PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    last_claimed_at timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO webhook_delivery_profiles (profile_id) SELECT DISTINCT profile_id FROM webhook_endpoints;
ALTER TABLE webhook_deliveries ADD COLUMN leased_until timestamptz;
CREATE INDEX webhook_deliveries_active_lease ON webhook_deliveries (endpoint_id, leased_until)
    WHERE leased_until IS NOT NULL;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM webhook_deliveries WHERE leased_until > now()) THEN
        RAISE EXCEPTION 'stop active webhook attempts before rollback';
    END IF;
END $$;
-- +goose StatementEnd
DROP INDEX webhook_deliveries_active_lease;
ALTER TABLE webhook_deliveries DROP COLUMN leased_until;
DROP TABLE webhook_delivery_profiles;
