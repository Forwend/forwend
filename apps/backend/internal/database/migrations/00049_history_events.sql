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

-- Invoices made before keep what their rows still show, marked backfilled. Who made one: Forwend for a retainer's later
-- month, the payer for a job deposit made on acceptance, else the owner. When its shown option reached its status: the
-- first transfer seen or deposit booked, paid when its settlement was queued (the same transaction), expired at
-- expiry. Its settlement.
INSERT INTO history_events (at, invoice_id, kind, actor, data)
SELECT at, invoice_id, kind, actor, data FROM (
    SELECT i.created_at AS at, i.id AS invoice_id, 'invoice.created' AS kind,
           CASE WHEN EXISTS (SELECT 1 FROM retainer_invoices r WHERE r.invoice_id = i.id AND r.cycle > 0) THEN 'system'
                WHEN EXISTS (SELECT 1 FROM job_payments p WHERE p.invoice_id = i.id AND p.on_accept) THEN 'payer'
                ELSE 'owner' END AS actor,
           '{"backfilled": true}'::jsonb AS data, 1 AS step
    FROM invoices i WHERE i.main_id IS NULL
    UNION ALL
    SELECT canceled_at, id, 'invoice.canceled', 'owner', '{"backfilled": true}', 2
    FROM invoices WHERE main_id IS NULL AND canceled_at IS NOT NULL
    UNION ALL
    SELECT coalesce(CASE c.payment_status
               WHEN 'detected' THEN (SELECT min(t.created_at) FROM chain_transfers t
                                     WHERE t.invoice_id = c.option_id AND t.status <> 'reorged')
               WHEN 'partially_paid' THEN (SELECT min(l.created_at) FROM ledger_transactions l
                                           WHERE l.invoice_id = c.option_id AND l.kind = 'deposit')
               WHEN 'paid' THEN (SELECT s.created_at FROM settlement_intents s WHERE s.invoice_id = c.option_id)
               ELSE to_timestamp(c.expires_at) END, c.created_at),
           c.id, 'invoice.' || c.payment_status, 'system', '{"backfilled": true}', 3
    FROM invoices_current c WHERE c.payment_status NOT IN ('open', 'canceled')
    UNION ALL
    SELECT s.updated_at, coalesce(o.main_id, o.id), 'invoice.settled', 'system',
           jsonb_strip_nulls(jsonb_build_object('backfilled', true, 'txHash', s.tx_hash)), 4
    FROM settlement_intents s JOIN invoices o ON o.id = s.invoice_id WHERE o.settlement_status = 'settled'
) b ORDER BY at, step;

-- +goose Down
DROP TABLE history_events;
