-- An option joins its invoice only while the invoice is open and has no transfer (F144): no code path adds one later,
-- and money already on the main row must never meet a new option.

-- +goose Up
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoices_options() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.chosen_id IS NOT NULL THEN
            RAISE EXCEPTION 'invoice % starts with no chosen option', NEW.id;
        END IF;
        IF NEW.main_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoices m WHERE m.id = NEW.main_id
            AND m.main_id IS NULL AND m.chosen_id IS NULL AND m.profile_id = NEW.profile_id
            AND m.recipient_address = NEW.recipient_address AND m.factory_address = NEW.factory_address
            AND m.receive_method = NEW.receive_method AND m.expires_at = NEW.expires_at
            AND m.settle_deadline = NEW.settle_deadline AND m.idempotency_key = NEW.idempotency_key
            AND m.request_hash = NEW.request_hash AND m.payment_status = 'open'
            AND NOT EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = m.id)) THEN
            RAISE EXCEPTION 'invoice option % must share its main row''s terms and join it before any money', NEW.id;
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.main_id IS DISTINCT FROM OLD.main_id THEN
        RAISE EXCEPTION 'invoice % option group never changes', OLD.id;
    END IF;
    IF NEW.chosen_id IS DISTINCT FROM OLD.chosen_id AND (OLD.chosen_id IS NOT NULL
        OR NOT (NEW.chosen_id = NEW.id OR EXISTS (SELECT 1 FROM invoices o WHERE o.id = NEW.chosen_id
                                                   AND o.main_id = NEW.id))) THEN
        RAISE EXCEPTION 'invoice % chosen option is set once, to one of its options', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION invoices_options() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.chosen_id IS NOT NULL THEN
            RAISE EXCEPTION 'invoice % starts with no chosen option', NEW.id;
        END IF;
        IF NEW.main_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoices m WHERE m.id = NEW.main_id
            AND m.main_id IS NULL AND m.chosen_id IS NULL AND m.profile_id = NEW.profile_id
            AND m.recipient_address = NEW.recipient_address AND m.factory_address = NEW.factory_address
            AND m.receive_method = NEW.receive_method AND m.expires_at = NEW.expires_at
            AND m.settle_deadline = NEW.settle_deadline AND m.idempotency_key = NEW.idempotency_key
            AND m.request_hash = NEW.request_hash) THEN
            RAISE EXCEPTION 'invoice option % must share its main invoice''s recipient, expiry and request', NEW.id;
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.main_id IS DISTINCT FROM OLD.main_id THEN
        RAISE EXCEPTION 'invoice % option group never changes', OLD.id;
    END IF;
    IF NEW.chosen_id IS DISTINCT FROM OLD.chosen_id AND (OLD.chosen_id IS NOT NULL
        OR NOT (NEW.chosen_id = NEW.id OR EXISTS (SELECT 1 FROM invoices o WHERE o.id = NEW.chosen_id
                                                   AND o.main_id = NEW.id))) THEN
        RAISE EXCEPTION 'invoice % chosen option is set once, to one of its options', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
