-- Who pays an invoice's fees (D-122): the owner, deducted at settlement, or the client, added on top. It is fixed with
-- the fees (R-228).
-- +goose Up
ALTER TABLE invoices ADD COLUMN fees_paid_by text NOT NULL DEFAULT 'owner' CHECK (fees_paid_by IN ('owner', 'client'));
DROP TRIGGER invoices_fees_fixed ON invoices;
CREATE TRIGGER invoices_fees_fixed BEFORE UPDATE ON invoices FOR EACH ROW
    WHEN ((NEW.network_fee, NEW.platform_fee, NEW.fees_paid_by) IS DISTINCT FROM
          (OLD.network_fee, OLD.platform_fee, OLD.fees_paid_by))
    EXECUTE FUNCTION invoices_fees_fixed();
ALTER TABLE invoices ENABLE ALWAYS TRIGGER invoices_fees_fixed;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM invoices WHERE fees_paid_by <> 'owner') THEN
        RAISE EXCEPTION 'can''t roll back: invoices have their client pay the fees';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP TRIGGER invoices_fees_fixed ON invoices;
CREATE TRIGGER invoices_fees_fixed BEFORE UPDATE ON invoices FOR EACH ROW
    WHEN (NEW.network_fee IS DISTINCT FROM OLD.network_fee OR NEW.platform_fee IS DISTINCT FROM OLD.platform_fee)
    EXECUTE FUNCTION invoices_fees_fixed();
ALTER TABLE invoices ENABLE ALWAYS TRIGGER invoices_fees_fixed;
ALTER TABLE invoices DROP COLUMN fees_paid_by;
