-- Invoice lines (R-88), in base units of the main row's token.

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

-- created_at = now() holds only in the transaction that made the invoice: now() is that transaction's start.
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
