-- First run (R-50, D-53). Existing users already use the app, so they count as onboarded.

-- +goose Up
ALTER TABLE users ADD COLUMN onboarded_at timestamptz;
UPDATE users SET onboarded_at = created_at;

-- +goose Down
ALTER TABLE users DROP COLUMN onboarded_at;
