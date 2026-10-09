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

## Data model (first version)
- `users`, `profiles(kind: personal|freelancer|merchant)`, `profile_wallets(provider, provider_wallet_id, address, chain_family)`
- `merchants → stores(project_id, branding)`, `team_members(role, store scope)` (Phase 10)
- `chains(chain_id, confirm_rule, finality_rule)`, `tokens(chain_id, contract, decimals, enabled)`
- `invoices`: immutable terms (`invoice_id`, profile, chain, token, `amount NUMERIC(78,0)`,
  `expires_at`, recipient address, receive address, `receive_method` (PROJECT D-44), salt). Addresses are
  text with a `chain_family`, never a 20-byte EVM type, `idempotency_key` unique per profile,
  separate status columns for **payment**, **settlement** and **refund**.
- `chain_transfers`: unique `(chain_id, tx_hash, log_index)`, `block_hash`, `block_number`,
  `block_time`, status `detected|confirmed|reorged`.
- `ledger_entries`: append-only; received, settled, refunded, held amounts per invoice.
- `settlement_intents` (unique per invoice), `refund_intents` (one per approved claim); nonce and tx hash tracked;
  reconcile before any retry.
- `refund_claims`, `support_cases` (wrong chain, late).
- `outbox_events`, `webhook_endpoints`, `webhook_deliveries` (Phase 10).
- `chain_cursors(chain_id, last_safe_block, last_finalized_block)`.

## Invoice state machine
```
open ──deposit seen──▶ detected ──confirmed < amount──▶ partially_paid ──confirmed ≥ amount──▶ paid
paid ──settlement confirmed──▶ settled          (excess > 0 → excess_held, refund-eligible)
open/partially_paid ──expires_at passes (block time)──▶ expired / expired_partially_paid (held)
any deposit with block_time > expires_at ──▶ late (held, never auto-credited)
held funds ──verified claim + platform approval──▶ refund_pending ──confirmed──▶ refunded
```
