-- Forwend's own code for Confirm it's you (R-137, D-49): Privy's email login made while signed in keeps the session and
-- its sign-in time, so the api emails a code and a confirmed one makes that Privy session fresh for 15 minutes.

-- +goose Up
CREATE TABLE fresh_sign_ins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id),
    -- The access token's Privy session (sid). A refresh keeps it, so whoever holds that session's refresh token shares
    -- its confirm for the 15 minutes (D-49). A new code still goes to the owner's inbox, and Sign out everywhere ends
    -- the session.
    session text NOT NULL CHECK (session <> ''),
    -- sha256 of the row id and the code: a code never sits in the table as itself.
    code_hash bytea NOT NULL,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    confirmed_at timestamptz
);
CREATE INDEX fresh_sign_ins_session ON fresh_sign_ins (user_id, session, created_at);

-- +goose Down
DROP TABLE fresh_sign_ins;
