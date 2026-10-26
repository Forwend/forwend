-- Public request input is independent of a reusable template's mutable title, price and limits (R-163).
-- +goose Up
ALTER TABLE payment_links ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE VIEW payment_link_usage AS
SELECT l.id AS link_id, count(i.id) FILTER (WHERE i.payment_status = 'paid') AS paid,
    count(i.id) FILTER (WHERE i.payment_status IN ('open', 'detected', 'partially_paid')) AS reserved
FROM payment_links l LEFT JOIN invoices_current i ON i.link_id = l.id GROUP BY l.id;

CREATE TABLE link_checkout_requests (
    invoice_id text PRIMARY KEY REFERENCES invoices (id),
    amount_cents bigint CHECK (amount_cents > 0),
    expected_amount_cents bigint CHECK (expected_amount_cents > 0),
    expected_revision bigint CHECK (expected_revision > 0)
);
-- +goose StatementBegin
CREATE FUNCTION link_checkout_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'link checkout requests are immutable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND main_id IS NULL
        AND link_id IS NOT NULL AND purpose = 'checkout' AND document_kind = 'none') THEN
        RAISE EXCEPTION 'a link checkout request belongs to its main document-free checkout';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER link_checkout_request_guard BEFORE INSERT OR UPDATE OR DELETE ON link_checkout_requests
    FOR EACH ROW EXECUTE FUNCTION link_checkout_request_guard();
CREATE TRIGGER link_checkout_request_truncate BEFORE TRUNCATE ON link_checkout_requests
    FOR EACH STATEMENT EXECUTE FUNCTION link_checkout_request_guard();

-- +goose StatementBegin
CREATE FUNCTION payment_link_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.profile_id, NEW.store_id, NEW.livemode, NEW.slug)
        IS DISTINCT FROM (OLD.profile_id, OLD.store_id, OLD.livemode, OLD.slug) THEN
        RAISE EXCEPTION 'payment link ownership, store, mode and slug never change';
    END IF;
    NEW.revision := OLD.revision + CASE WHEN (NEW.title, NEW.amount_cents, NEW.min_cents, NEW.max_cents,
        NEW.ends_at, NEW.max_payments, NEW.active) IS DISTINCT FROM
        (OLD.title, OLD.amount_cents, OLD.min_cents, OLD.max_cents, OLD.ends_at, OLD.max_payments, OLD.active)
        THEN 1 ELSE 0 END;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER payment_link_identity_guard BEFORE UPDATE ON payment_links
    FOR EACH ROW EXECUTE FUNCTION payment_link_identity_guard();

-- +goose StatementBegin
CREATE FUNCTION invoice_link_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.link_id IS NOT NULL AND (NEW.link_id, NEW.store_id, NEW.profile_id)
        IS DISTINCT FROM (OLD.link_id, OLD.store_id, OLD.profile_id) THEN
        RAISE EXCEPTION 'payment link checkout source never changes';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER invoice_link_source_guard BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION invoice_link_source_guard();

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM link_checkout_requests) THEN
        RAISE EXCEPTION 'cannot roll back link retry metadata while purchases exist';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP TRIGGER invoice_link_source_guard ON invoices;
DROP FUNCTION invoice_link_source_guard();
DROP TRIGGER payment_link_identity_guard ON payment_links;
DROP FUNCTION payment_link_identity_guard();
DROP TABLE link_checkout_requests;
DROP FUNCTION link_checkout_request_guard();
DROP VIEW payment_link_usage;
ALTER TABLE payment_links DROP COLUMN revision;
