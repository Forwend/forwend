-- Invoice line items (R-88): an optional breakdown of an invoice's amount, in the base units of the invoice's token (the
-- main row's). Like the invoice's other details they are written with it and never change, and they add up exactly to
-- its amount: Postgres checks the sum when the transaction commits.

-- +goose Up
CREATE TABLE invoice_lines (
    invoice_id text NOT NULL REFERENCES invoices (id),
    position int NOT NULL CHECK (position BETWEEN 1 AND 50),
    description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
    quantity numeric(9, 2) NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
    unit_price uint256 NOT NULL,
    amount uint256 NOT NULL CHECK (amount = quantity * unit_price),
    PRIMARY KEY (invoice_id, position)
);

-- Lines belong to an invoice's main row and come in the transaction that makes it (created_at is that transaction's
-- start, as now() is), so an issued invoice never gains a line; none ever changes or goes.
-- +goose StatementBegin
CREATE FUNCTION invoice_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'invoice % lines never change', OLD.invoice_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND main_id IS NULL AND created_at = now()) THEN
        RAISE EXCEPTION 'invoice % takes lines only when it is made', NEW.invoice_id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
    FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();
ALTER TABLE invoice_lines ENABLE ALWAYS TRIGGER invoice_lines_guard;

-- +goose StatementBegin
CREATE FUNCTION invoice_lines_sum() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT sum(amount) FROM invoice_lines WHERE invoice_id = NEW.invoice_id)
       IS DISTINCT FROM (SELECT amount FROM invoices WHERE id = NEW.invoice_id) THEN
        RAISE EXCEPTION 'invoice % lines do not add up to its amount', NEW.invoice_id;
    END IF;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE CONSTRAINT TRIGGER invoice_lines_sum AFTER INSERT ON invoice_lines
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION invoice_lines_sum();
ALTER TABLE invoice_lines ENABLE ALWAYS TRIGGER invoice_lines_sum;

-- +goose Down
DROP TABLE invoice_lines;
DROP FUNCTION invoice_lines_sum();
DROP FUNCTION invoice_lines_guard();
