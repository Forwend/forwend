-- The invoice list search (F110). Must stay the same expression as internal/invoice/list.go, searchText.

-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX invoices_search ON invoices USING gin ((
    'INV-' || lpad(number::text, greatest(length(number::text), 4), '0') || ' ' || coalesce(title, '')
    || ' ' || coalesce(note, '') || ' ' || coalesce(client_name, '') || ' ' || coalesce(client_email, '') || ' '
    || receive_address) gin_trgm_ops);

-- +goose Down
-- pg_trgm stays: it may have been there before this migration.
DROP INDEX invoices_search;
