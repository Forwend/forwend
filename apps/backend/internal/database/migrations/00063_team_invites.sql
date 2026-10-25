-- Team invites (R-139, D-93). The link's token is never kept here: token_hash is its SHA-256. The invite email's outbox
-- row carries the token until the worker sends the email or gives up, and then drops it.

-- +goose Up
CREATE TABLE profile_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles (id),
    email text NOT NULL CHECK (email = lower(email)),
    role text NOT NULL CHECK (role IN ('admin', 'developer', 'finance')),
    stores uuid[] NOT NULL DEFAULT '{}',
    token_hash bytea NOT NULL UNIQUE CHECK (length(token_hash) = 32),
    invited_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
    accepted_at timestamptz,
    revoked_at timestamptz
);
-- One open invite per address: a new one revokes the last.
CREATE UNIQUE INDEX profile_invites_open ON profile_invites (profile_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE outbox_events ADD COLUMN invite_id uuid REFERENCES profile_invites (id);
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder', 'job.change', 'team.invite'));
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_invite
    CHECK ((kind = 'team.invite') = (invite_id IS NOT NULL AND invoice_id IS NULL AND user_id IS NULL AND job_id IS NULL));
-- Invites are emails to people outside Forwend, so they count toward the client email cap (R-116).
DROP INDEX outbox_events_client_recent;
CREATE INDEX outbox_events_client_recent ON outbox_events (created_at)
    WHERE kind IN ('invoice.sent', 'invoice.reminder', 'job.change', 'team.invite');

-- +goose Down
DROP INDEX outbox_events_client_recent;
CREATE INDEX outbox_events_client_recent ON outbox_events (created_at)
    WHERE kind IN ('invoice.sent', 'invoice.reminder', 'job.change');
DELETE FROM outbox_events WHERE kind = 'team.invite';
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_invite;
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder', 'job.change'));
ALTER TABLE outbox_events DROP COLUMN invite_id;
DROP TABLE profile_invites;
