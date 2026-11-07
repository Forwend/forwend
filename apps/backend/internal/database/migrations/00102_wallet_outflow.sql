-- Money that leaves a profile wallet without a send the owner approved in Forwend tells the owner at once (D-49): a
-- stolen session can sign through Privy without Forwend's screens.

-- +goose Up
ALTER TABLE outbox_events ADD COLUMN wallet_transfer_id bigint REFERENCES wallet_transfers (id);
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder', 'job.change', 'team.invite', 'webhook.disabled', 'settlement.waiting',
                    'wallet.outflow'));
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_outflow
    CHECK ((kind = 'wallet.outflow') = (wallet_transfer_id IS NOT NULL AND invoice_id IS NULL AND user_id IS NULL
                                        AND job_id IS NULL AND invite_id IS NULL AND endpoint_id IS NULL));
CREATE UNIQUE INDEX outbox_events_one_outflow ON outbox_events (wallet_transfer_id) WHERE kind = 'wallet.outflow';

-- +goose Down
DROP INDEX outbox_events_one_outflow;
DELETE FROM outbox_events WHERE kind = 'wallet.outflow';
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_outflow;
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_kind_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_kind_check
    CHECK (kind IN ('invoice.paid', 'invoice.settled', 'invoice.held', 'invoice.receipt', 'account.welcome', 'invoice.sent',
                    'invoice.reminder', 'job.change', 'team.invite', 'webhook.disabled', 'settlement.waiting'));
ALTER TABLE outbox_events DROP COLUMN wallet_transfer_id;
