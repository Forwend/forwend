-- An unpaid link purchase holds its slot for 15 minutes (invoice.MinExpiresIn, the shortest checkout close) unless a
-- deposit is seen: anyone can start one, so a longer hold lets strangers fill a link without paying (D-108).
-- +goose Up
CREATE OR REPLACE VIEW payment_link_usage AS
SELECT l.id AS link_id, count(i.id) FILTER (WHERE i.payment_status = 'paid') AS paid,
    count(i.id) FILTER (WHERE i.payment_status IN ('detected', 'partially_paid') OR i.payment_status = 'open' AND (
        i.created_at > now() - interval '15 minutes'
        OR EXISTS (SELECT 1 FROM invoices o JOIN chain_transfers t ON t.invoice_id = o.id
            WHERE coalesce(o.main_id, o.id) = i.id AND t.status <> 'reorged')
        OR EXISTS (SELECT 1 FROM crosschain_quotes q WHERE q.invoice_id = i.id AND q.deposit_seen_at IS NOT NULL))) AS reserved
FROM payment_links l LEFT JOIN invoices_current i ON i.link_id = l.id GROUP BY l.id;

-- +goose Down
CREATE OR REPLACE VIEW payment_link_usage AS
SELECT l.id AS link_id, count(i.id) FILTER (WHERE i.payment_status = 'paid') AS paid,
    count(i.id) FILTER (WHERE i.payment_status IN ('open', 'detected', 'partially_paid')) AS reserved
FROM payment_links l LEFT JOIN invoices_current i ON i.link_id = l.id GROUP BY l.id;
