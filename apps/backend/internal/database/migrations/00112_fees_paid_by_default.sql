-- Who pays an invoice's fees by default (D-122, R-227): the profile's choice, which a payment link may override (null
-- keeps the profile's). When the client pays, the amount is the price plus the fees, and the lines add up to the price.
-- +goose Up
ALTER TABLE profiles ADD COLUMN fees_paid_by text NOT NULL DEFAULT 'owner' CHECK (fees_paid_by IN ('owner', 'client'));
ALTER TABLE payment_links ADD COLUMN fees_paid_by text CHECK (fees_paid_by IN ('owner', 'client'));
-- What the payer pays changes with who pays the fees, so a checkout made for the link's older revision is refused.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION payment_link_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.profile_id, NEW.store_id, NEW.livemode, NEW.slug)
        IS DISTINCT FROM (OLD.profile_id, OLD.store_id, OLD.livemode, OLD.slug) THEN
        RAISE EXCEPTION 'payment link ownership, store, mode and slug never change';
    END IF;
    NEW.revision := OLD.revision + CASE WHEN (NEW.title, NEW.amount_cents, NEW.min_cents, NEW.max_cents,
        NEW.ends_at, NEW.max_payments, NEW.active, NEW.fees_paid_by) IS DISTINCT FROM
        (OLD.title, OLD.amount_cents, OLD.min_cents, OLD.max_cents, OLD.ends_at, OLD.max_payments, OLD.active,
         OLD.fees_paid_by)
        THEN 1 ELSE 0 END;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoice_lines_sum() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT sum(amount) FROM invoice_lines WHERE invoice_id = NEW.invoice_id)
       IS DISTINCT FROM (SELECT amount - CASE WHEN fees_paid_by = 'client' THEN network_fee + platform_fee ELSE 0 END
                         FROM invoices WHERE id = NEW.invoice_id) THEN
        RAISE EXCEPTION 'invoice % lines do not add up to its price', NEW.invoice_id;
    END IF;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM invoices WHERE fees_paid_by = 'client' AND network_fee + platform_fee > 0) THEN
        RAISE EXCEPTION 'can''t roll back: invoices add their fees on top of the price';
    END IF;
END;
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoice_lines_sum() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT sum(amount) FROM invoice_lines WHERE invoice_id = NEW.invoice_id)
       IS DISTINCT FROM (SELECT amount FROM invoices WHERE id = NEW.invoice_id) THEN
        RAISE EXCEPTION 'invoice % lines do not add up to its amount', NEW.invoice_id;
    END IF;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION payment_link_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
ALTER TABLE payment_links DROP COLUMN fees_paid_by;
ALTER TABLE profiles DROP COLUMN fees_paid_by;
