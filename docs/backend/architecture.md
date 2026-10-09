# Backend architecture

The Go backend in `apps/backend` (PLAN Phase 6). Code rules: [rules.md](rules.md).
Requirements: R-14…R-24 in [PROJECT.md](../PROJECT.md). Whole system: [architecture.md](../architecture.md).

Current skeleton: config, Postgres migrations and `/healthz`. Worker and signer only start and wait.
The processes and schema below are the target for R-15…R-24.

## Processes
- `api`: public HTTP API + dashboard API. Verifies Privy tokens, authorizes the active profile,
  creates invoices, serves state. Holds **no** private keys.
- `worker`: chain watcher (block cursor per chain, `eth_getLogs` for allowlisted tokens filtered
  to active receiver addresses), confirmation/finality tracking, reorg handling, invoice state
  machine, outbox processing, webhook delivery, reconciliation.
- `signer`: separate process, own credentials, no public routes, no user sessions. Accepts only
  typed intents ("settle invoice X"). Refunds are not signed here: an approved claim becomes a
  proposed Safe transaction that the multisig owners approve. Re-reads the ledger and the chain
  itself before signing. Caps amounts, allows only known contract methods, writes its own audit
  log. Separate DB role with read access plus its own intent tables.

## Data model

Built in `internal/database/migrations` (R-17); Postgres enforces the rules below, each with a test.

- `users`, `profiles(kind: personal|freelancer|merchant)` (one personal per user),
  `profile_wallets(provider, provider_wallet_id, address, chain_family)` (one per profile and family).
- `merchants → stores(project_id, branding)`, `team_members(role, store scope)` (Phase 10).
- `chains(chain_id, chain_family, enabled)`, `tokens(chain_id, contract, decimals, enabled)`. One confirm rule for all
  chains (D-45), so no per-chain rule columns.
- `invoices`: immutable terms (`id` = the on-chain invoice id, profile, chain, token, `amount`, `expires_at` and
  `settle_deadline` as the contract's uint64 seconds, recipient, factory and receive address, `receive_method` (D-44)),
  separate **payment**, **settlement** and **refund** status columns, `idempotency_key` unique per profile with a
  SHA-256 `request_hash` of the create request.
- `chain_transfers`: `block_hash`, `block_number`, `block_time`, status `detected|confirmed|reorged`. A transfer must go to
  its invoice's receive address, for the invoice's token, on its chain (foreign key).
- `ledger_transactions` + `ledger_entries`: double-entry, append-only (below).
- `settlement_intents` (unique per invoice), `refund_intents` (one per approved claim); nonce and tx hash tracked;
  reconcile before any retry.
- `refund_claims`, `support_cases` (wrong chain, late).
- `outbox_events` (written in the same transaction as the change, published at least once), `webhook_endpoints`,
  `webhook_deliveries` (Phase 10).
- `chain_cursors(chain_id, last_scanned_block, last_finalized_block)`.

Rules:
- **Amounts**: domain `uint256` = `NUMERIC(78,0)` checked to 0…2^256−1 (the type alone accepts up to 10^78−1). Postgres
  rounds a fraction silently, so Go parses decimal strings into `big.Int` before any insert.
- **Addresses and hashes**: text with a `chain_family`; for `evm` only lowercase `0x` hex passes a CHECK. A mixed-case
  (EIP-55) copy would otherwise dodge the unique indexes. Lowercase in Go on the way in; checksum only for display.
- **Statuses**: text + CHECK, not Postgres enums (enum values can't be removed). Allowed transitions are F049's job.
- **Transfer identity**: `log_index` is the log's position in the block. After a reorg the row stays `reorged` and the
  same transaction can be mined again with the same log index, so `(chain_id, tx_hash, log_index)` is unique only while
  not reorged; `(chain_id, block_hash, log_index)` is always unique.
- **Ledger**: per invoice three implicit accounts: `receiver` (the tokens at its address), `recipient_payable` (owed to
  the creator), `payer_held` (owed to payers). Entries are signed (debit > 0) and a deferred trigger rejects at commit
  any transaction that does not sum to zero, so the receiver balance always equals what is owed. Only finalized
  transfers are booked, once each (D-45): a deposit needs a `confirmed` transfer and sets its `booked` flag, and a booked
  transfer can never change, so it can't be marked `reorged` and booked again. The flag is a real write, so a
  concurrent reorg update fails at every isolation level, and at commit it must match the ledger. Every ledger transaction has at least 2 entries. Corrections are
  `reversal` transactions, at most one per transaction.
- **Append-only**: UPDATE, DELETE and TRUNCATE on the ledger tables raise an error. The triggers are `ENABLE ALWAYS`, so
  `session_replication_role = replica` does not skip them. The table owner can still drop them: in deployment the
  app and signer roles must not own the tables and get only `SELECT, INSERT` on the ledger.
- Balances are `SUM` over entries. Add a stored balance with a version column when that gets slow.

Sources: PostgreSQL 17 docs ([CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html),
[numeric](https://www.postgresql.org/docs/17/datatype-numeric.html), [enum](https://www.postgresql.org/docs/17/datatype-enum.html)),
[EIP-55](https://eips.ethereum.org/EIPS/eip-55), [Ethereum JSON-RPC `logIndex`](https://ethereum.org/developers/docs/apis/json-rpc/),
ledger designs from [Modern Treasury](https://www.moderntreasury.com/journal/accounting-for-developers-part-ii),
[pgledger](https://github.com/pgr0ss/pgledger) and [Stripe](https://stripe.dev/blog/ledger-stripe-system-for-tracking-and-validating-money-movement),
idempotency from [Brandur Leach](https://brandur.org/idempotency-keys).

## Invoice state machine
```
open ──deposit seen──▶ detected ──confirmed < amount──▶ partially_paid ──confirmed ≥ amount──▶ paid
paid ──settlement confirmed──▶ settled          (excess > 0 → excess_held, refund-eligible)
open/partially_paid ──expires_at passes (block time)──▶ expired / expired_partially_paid (held)
any deposit with block_time > expires_at ──▶ late (held, never auto-credited)
held funds ──verified claim + platform approval──▶ refund_pending ──confirmed──▶ refunded
```
