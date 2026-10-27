-- +goose Up
CREATE INDEX invoices_payment_search ON invoices USING gin
 ((coalesce(reference,'') || ' ' || coalesce(title,'') || ' ' || coalesce(client_name,'') || ' ' || coalesce(client_email,'') || ' ' || id) gin_trgm_ops);

-- +goose Down
DROP INDEX invoices_payment_search;
