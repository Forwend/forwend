-- A profile's mode (D-120, R-221): Developer mode on is test mode, off is live mode. Profiles made before this keep
-- test mode, so their testnet invoices stay in view. A new profile starts in live mode when a mainnet is switched on;
-- where none is, as on staging, it starts in test mode so it can take payments.

-- +goose Up
ALTER TABLE profiles ADD COLUMN livemode boolean NOT NULL DEFAULT false;

-- +goose StatementBegin
CREATE FUNCTION profile_mode_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.livemode := EXISTS (SELECT 1 FROM chains WHERE enabled AND livemode);
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER profile_mode_default BEFORE INSERT ON profiles
    FOR EACH ROW EXECUTE FUNCTION profile_mode_default();

-- +goose Down
DROP TRIGGER profile_mode_default ON profiles;
DROP FUNCTION profile_mode_default();
ALTER TABLE profiles DROP COLUMN livemode;
