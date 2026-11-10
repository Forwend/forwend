-- invoices_profile_closes and invoices_profile_created (00120) start with profile_id, so they serve every lookup by
-- profile alone: invoices_profile only costs writes. CONCURRENTLY does not block invoice writes on a live database.
-- +goose NO TRANSACTION
-- +goose Up
DROP INDEX CONCURRENTLY IF EXISTS invoices_profile;

-- +goose Down
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_profile ON invoices (profile_id);
