-- The invoice list's search (F110) looks for text anywhere in a few fields (internal/invoice/list.go, searchText; the
-- expression here must stay the same). Without this index a search that matches little read every invoice of the
-- profile: 45 ms at 20,000 invoices; with it, 0.02 ms.

-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX invoices_search ON invoices USING gin ((
    'INV-' || lpad(number::text, greatest(length(number::text), 4), '0') || ' ' || coalesce(title, '')
    || ' ' || coalesce(note, '') || ' ' || coalesce(client_name, '') || ' ' || coalesce(client_email, '') || ' '
    || receive_address) gin_trgm_ops);

-- +goose Down
-- pg_trgm stays: it may have been there before this migration.
DROP INDEX invoices_search;
