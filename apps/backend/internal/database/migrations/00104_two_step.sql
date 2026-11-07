-- The MFA methods Forwend saw set up behind a fresh sign-in (R-219), each as type:verified_at at Privy. Only these
-- stand in for Forwend's emailed code on a send (D-49); one a stolen session set up at Privy alone doesn't match.

-- +goose Up
ALTER TABLE users ADD COLUMN two_step_methods text[] NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE users DROP COLUMN two_step_methods;
