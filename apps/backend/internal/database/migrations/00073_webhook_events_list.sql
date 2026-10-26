-- The webhook events list (R-153): a profile's invoice events, newest first by their history row.

-- +goose Up
CREATE INDEX webhook_events_profile ON webhook_events (profile_id, history_id);

-- +goose Down
DROP INDEX webhook_events_profile;
