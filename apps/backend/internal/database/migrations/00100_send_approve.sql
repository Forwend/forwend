-- A send is approved once (R-211): the browser signs it after the approve, and a second approve is refused, so one
-- summary is never signed twice. A signature whose answer the browser lost may still have gone out, so an approved
-- send the browser never reported holds the wallet until the watcher finds its transfer or the hold ends.

-- +goose Up
ALTER TABLE sends DROP CONSTRAINT sends_status_check;
ALTER TABLE sends ADD CONSTRAINT sends_status_check
    CHECK (status IN ('prepared', 'approved', 'submitted', 'sent', 'failed', 'canceled', 'expired'));
ALTER TABLE sends ADD COLUMN approved_at timestamptz;
-- A send signed before this was approved by its hold on Send: its transfer must not read as one with no send.
UPDATE sends SET approved_at = submitted_at WHERE submitted_at IS NOT NULL;
ALTER TABLE sends ADD CONSTRAINT sends_approved CHECK (status <> 'approved' OR approved_at IS NOT NULL);
DROP INDEX sends_one_unsigned;
CREATE UNIQUE INDEX sends_one_unsigned ON sends (from_address, chain_id) WHERE status IN ('prepared', 'approved');

-- +goose Down
DROP INDEX sends_one_unsigned;
UPDATE sends SET status = 'expired', finished_at = now() WHERE status = 'approved';
CREATE UNIQUE INDEX sends_one_unsigned ON sends (from_address, chain_id) WHERE status = 'prepared';
ALTER TABLE sends DROP CONSTRAINT sends_approved;
ALTER TABLE sends DROP COLUMN approved_at;
ALTER TABLE sends DROP CONSTRAINT sends_status_check;
ALTER TABLE sends ADD CONSTRAINT sends_status_check
    CHECK (status IN ('prepared', 'submitted', 'sent', 'failed', 'canceled', 'expired'));
