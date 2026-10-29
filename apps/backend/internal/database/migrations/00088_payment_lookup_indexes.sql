-- +goose Up
DROP INDEX invoices_payment_search;
CREATE INDEX invoices_payment_search ON invoices USING gin
 ((coalesce(reference,'') || ' ' || coalesce(title,'') || ' ' || coalesce(client_name,'') || ' ' || coalesce(client_email,'') || ' ' || id
   || ' ' || coalesce('INV-' || lpad(number::text, greatest(length(number::text), 4), '0'), '') || ' ' || receive_address) gin_trgm_ops);
-- Option rows too: the main-row indexes are partial.
CREATE INDEX invoices_profile ON invoices (profile_id);
CREATE INDEX invoices_profile_reference ON invoices (profile_id, reference) WHERE main_id IS NULL AND reference IS NOT NULL;

-- +goose Down
DROP INDEX invoices_profile_reference;
DROP INDEX invoices_profile;
DROP INDEX invoices_payment_search;
CREATE INDEX invoices_payment_search ON invoices USING gin
 ((coalesce(reference,'') || ' ' || coalesce(title,'') || ' ' || coalesce(client_name,'') || ' ' || coalesce(client_email,'') || ' ' || id) gin_trgm_ops);
