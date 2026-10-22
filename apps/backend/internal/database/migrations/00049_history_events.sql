-- What happened to each invoice (R-123, D-92): one row per change, written by history.Add in the transaction that
-- makes it, so the history can't miss a change or show one that rolled back. Append-only like the ledger.

-- +goose Up
CREATE TABLE history_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at timestamptz NOT NULL DEFAULT now(),
    invoice_id text NOT NULL REFERENCES invoices (id), -- the main row: an option's change is its invoice's
    kind text NOT NULL CHECK (kind ~ '^[a-z]+\.[a-z_]+$'),
    actor text NOT NULL CHECK (actor IN ('owner', 'payer', 'system')),
    data jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 2048)
);
CREATE INDEX history_events_invoice ON history_events (invoice_id, id);

-- ENABLE ALWAYS: the guards also fire with session_replication_role = replica. TRUNCATE skips row triggers.
CREATE TRIGGER history_events_append_only BEFORE UPDATE OR DELETE ON history_events
    FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER history_events_no_truncate BEFORE TRUNCATE ON history_events
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
ALTER TABLE history_events ENABLE ALWAYS TRIGGER history_events_append_only;
ALTER TABLE history_events ENABLE ALWAYS TRIGGER history_events_no_truncate;

-- Invoices made before keep what their rows still show: when they were made and canceled, their payment status at the
-- time of their last booking, and their settlement. Who made them is not kept, so a backfilled creation reads as the
-- owner's.
INSERT INTO history_events (at, invoice_id, kind, actor, data)
SELECT at, invoice_id, kind, actor, data FROM (
    SELECT created_at AS at, id AS invoice_id, 'invoice.created' AS kind, 'owner' AS actor,
           '{"backfilled": true}'::jsonb AS data, 1 AS step
    FROM invoices WHERE main_id IS NULL
    UNION ALL
    SELECT canceled_at, id, 'invoice.canceled', 'owner', '{"backfilled": true}', 2
    FROM invoices WHERE main_id IS NULL AND canceled_at IS NOT NULL
    UNION ALL
    SELECT coalesce((SELECT max(t.created_at) FROM ledger_transactions t JOIN invoices o ON o.id = t.invoice_id
                     WHERE coalesce(o.main_id, o.id) = c.id), c.created_at),
           c.id, 'invoice.' || c.payment_status, 'system', '{"backfilled": true}', 3
    FROM invoices_current c WHERE c.payment_status NOT IN ('open', 'canceled')
    UNION ALL
    SELECT s.updated_at, coalesce(o.main_id, o.id), 'invoice.settled', 'system',
           jsonb_build_object('backfilled', true, 'txHash', s.tx_hash), 4
    FROM settlement_intents s JOIN invoices o ON o.id = s.invoice_id WHERE o.settlement_status = 'settled'
) b ORDER BY at, step;

-- +goose Down
DROP TABLE history_events;
