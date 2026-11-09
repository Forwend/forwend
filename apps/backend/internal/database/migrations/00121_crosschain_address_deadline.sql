-- R-234: 1Click's own deadline for a quote's deposit address, from its signed answer. The address takes deposits until
-- then, days past the deadline Forwend asked for, so the worker reads a quote nobody paid until then. Null without one.
-- +goose Up
ALTER TABLE crosschain_quotes ADD COLUMN address_deadline timestamptz;
UPDATE crosschain_quotes SET address_deadline = (signed::jsonb #>> '{quote,deadline}')::timestamptz
WHERE signed IS JSON OBJECT;
-- A quote the worker stopped reading while its address still takes deposits is read again.
UPDATE crosschain_quotes SET next_check_at = now()
WHERE next_check_at IS NULL AND status = 'PENDING_DEPOSIT' AND address_deadline > now();

-- +goose Down
ALTER TABLE crosschain_quotes DROP COLUMN address_deadline;
