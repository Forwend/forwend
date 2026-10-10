-- First run (R-50, D-53): set once by POST /v1/me/onboarding. Users who signed up before it already use the app, so
-- they count as onboarded and never see the first-run screen.

-- +goose Up
ALTER TABLE users ADD COLUMN onboarded_at timestamptz;
UPDATE users SET onboarded_at = created_at;

-- +goose Down
ALTER TABLE users DROP COLUMN onboarded_at;
