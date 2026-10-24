-- Sign out everywhere (R-137, D-49): a signed-in route refuses an access token issued before this time.

-- +goose Up
ALTER TABLE users ADD COLUMN sessions_revoked_at timestamptz;

-- +goose Down
ALTER TABLE users DROP COLUMN sessions_revoked_at;
