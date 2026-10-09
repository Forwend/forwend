# Backend architecture

The Go backend in `apps/backend` (PLAN Phase 6). Code rules: [rules.md](rules.md).
Requirements: R-14…R-24 in [PROJECT.md](../PROJECT.md). Whole system: [architecture.md](../architecture.md).

Built: signup and profiles API, balances and activity API, invoice API, Privy auth, watcher, ledger and signer, run by `api`, `worker` and `signer`; the gate
(`apps/backend/e2e`, R-23) runs the whole loop. Not built yet: refunds, webhooks, merchants.

## Processes
- `api`: public HTTP API + dashboard API. Verifies Privy tokens, authorizes the active profile,
  creates invoices, serves state. Reads profile wallet balances from each chain's second RPC at its finalized block
  (D-15, D-45), picked from the chain list like the worker's. Holds **no** private keys.
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

- `users`, `profiles(kind: personal|freelancer|merchant, name, idempotency_key)` (one personal per user, made at
  signup without a key; other kinds once per user and key), `profile_wallets(provider, provider_wallet_id, address, chain_family)` (one per profile and family).
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

## Privy

`internal/privy` wraps the Privy Go SDK (D-12). `ProfileWallet` returns a profile's user-owned EVM wallet: it looks
the wallet up by `external_id` = profile id and owner, and creates it only if missing, so a repeated or concurrent
call never makes a second one (Privy keeps `external_id` unique per app); the address comes back lowercase (R-31).
No idempotency key: Privy replays a cached error for a key for 24 hours, which would block a wallet after one
failed create. The server never signs
for these wallets (D-46). Tests run against a fake Privy API (`privy/privytest`); `-tags privylive` runs one against
the Privy test app. Each call is bounded by `privy.Timeout` (20 s, under the api's 30 s write timeout).

`internal/profile` (R-32) signs a user up (`POST /v1/me`: the user and personal profile, inserted in one transaction with
`ON CONFLICT DO NOTHING`) and creates freelancer and merchant profiles once per Idempotency-Key. Each then gets its
wallet from `ProfileWallet`, outside any transaction; the wallet row is stored under a lock on the profile row, so
concurrent requests store one, and a wallet already stored for another profile is an error. If Privy fails, the
profile is left without a wallet (`walletAddress: null`) and repeating the request makes it.

## Running the loop

`worker` and `signer` read the shared chain list (`CHAINS_FILE`, `packages/contracts/chains.json`) and
`INFURA_API_KEYS`, and serve the chains enabled in the `chains` table. `internal/chain` picks RPCs like
`script/rpc.mjs`: each Infura key, then public RPCs, only URLs whose `eth_chainId` matches. The first working one
reads the chain; the next one on another host checks balances (D-15). A chain without two working hosts is not
served (Tempo Moderato lists one RPC: add a second before enabling it). After any error the next round picks again,
so a rate-limited key is skipped. Logged RPC errors are redacted: go-ethereum puts the URL, Infura key included, in
network errors. Each chain's round has a 2-minute limit. Every `POLL_INTERVAL` the worker runs, per chain, a watcher scan then the ledger; the
signer runs its due intents. The gate starts all three binaries against Postgres and Anvil, creates an invoice through
the API, pays it and waits for detected → paid → settled with the deposit going detected → confirmed.

## Watcher

`internal/watcher` (R-20), one `Chain` per chain; never two at once for one chain (they would race on the cursor).
Each `Scan` reads `latest`, then `eth_getLogs` for `Transfer` from the invoices' tokens to their receive addresses,
from 64 blocks below the last finalized block (or from the oldest `detected` row) to latest, in ranges of at most
2,000 blocks. One JSON-RPC batch then reads `finalized` and the header of every block it judges, so they usually come
from one node. One transaction then:
- marks a `detected` row `reorged` only when the chain shows another block hash at its height; a log merely missing
  from one answer (a lagging or overloaded node) proves nothing;
- inserts each deposit whose block hash matches, `confirmed` when the block is at or below `finalized` (D-45), else
  `detected`; a `reorged` row whose block is canonical again comes back;
- moves `chain_cursors`, never below the last finalized block.
The 64-block rescan means one empty or lagging answer is never the last look at a final block. Only the invoice's own
token counts, and the row stores the emitting contract, so the foreign key also rejects a look-alike. Block hashes and
times come from the RPC, never computed in Go. Arc's native-coin `Transfer` logs are ignored (see money-safety). A
chain's first scan starts at its finalized block: deposits before it are not looked for. Scanning again changes
nothing, so a restarted worker resumes from the cursor.

## Signer

`internal/settlement` (R-22), one `Signer` per executor key. When the ledger marks an invoice `paid` it queues one
settlement intent (unique per invoice) in the same transaction. For each due intent the signer:
1. If a settle is already saved (`sent`), finishes it first, whatever changed since: the receiver's own `settled()`
   decides. The saved bytes must decode to `settle()` on this receiver on this chain with the saved hash.
2. Otherwise re-reads the terms and refuses for good (`refused` with a reason, nothing sent) unless the invoice is
   `paid`, the recipient is the profile's wallet, the factory is the compiled one and the terms recompute the stored
   receive address; also when `factory.status` predicts another address.
3. Waits and retries (back to `pending` with a reason; 1 min doubling to 1 h) on temporary conditions: wrong chain,
   balance below the amount, not settleable (paused), a mined settle that left the receiver unsettled, a saved
   settle whose nonce another transaction took, or a settler other than this executor (the deadline passed: it sends
   nothing and waits for the refund authority's settle).
4. Deploys the receiver if needed (`deploy` is idempotent), signs `settle()` with the chain's own gas estimate, saves
   sender, nonce, hash and signed bytes, then sends. After a crash it sends the same saved bytes again (same nonce, so
   at most one settle can be mined). The contract's `AlreadySettled` is a last guard.
5. Once `settled()` is true at the finalized block (D-45), in one transaction: intent `confirmed`, a `settlement`
   ledger transaction (receiver and recipient_payable each −amount; one per invoice) and the invoice's
   `settlement_status` `settled`. A settle a reorg drops before that is reconciled like an unsent one.
Each intent's attempt has a 3-minute limit, so an RPC that stops answering can't stall the others.
It signs only `factory.deploy(terms)` and `receiver.settle()`, and only for chains enabled in the database: a chain
disabled there is dropped next round, and a round whose enabled list can't be read sends nothing. A receiver settled
outside our signer (the refund authority after the deadline) still confirms its intent. `retry` and `refuse` only
change an intent still in the status the attempt loaded. Known limit: no fee bumping for a stuck transaction yet.

## Invoice states

`internal/ledger` (R-21) runs after each scan, per invoice, in one transaction with the invoice row locked:
- Books each `confirmed`, not yet booked transfer in chain order: `receiver` gets the transfer amount; what is still
  owed up to the invoice amount goes to `recipient_payable`, the rest to `payer_held`. A late deposit (block time
  after `expires_at`) and any deposit after the invoice is final go entirely to `payer_held` (D-24, D-26).
- Payment status: `open` → `detected` (a transfer seen) → `partially_paid` → `paid` when the full amount is owed and
  a second RPC's `balanceOf` covers every booked deposit (D-15). An invoice owed in full never expires; it waits for
  the second RPC. Otherwise it becomes `expired` or `expired_partially_paid` once the chain's finalized block time
  passes `expires_at`, no transfer is still `detected`, and the second RPC's balance equals the booked amount. More on
  chain than booked (a missed log, an Arc native-coin payment) blocks expiry and logs a warning. An expired partial
  payment is moved to `payer_held` by an `expiry` ledger transaction. `refund_status` becomes `held` while
  `payer_held` > 0. One invoice's error doesn't stop the others; each balance call has a 10 s limit.
- The second RPC reads `balanceOf` at its own finalized block and reports that block, so a primary RPC that calls a
  deposit final too early can't get an invoice paid (D-15, D-45). An answer from behind the watcher's finalized block
  may miss final deposits, so it decides nothing (neither paid nor expired) until the node catches up. Every RPC in
  the chain list serves `eth_call` at the finalized block (checked 2026-10-09).
- `paid`, `expired` and `expired_partially_paid` are final. A trigger rejects any other status change, any change to
  invoice terms, and an invoice created with any status but `open`.
- `GET /v1/invoices/{id}` lists deposits with `blocksLeft`/`secondsLeft` from the finalized block (R-28).

```
open ──transfer seen──▶ detected ──booked < amount──▶ partially_paid ──booked ≥ amount and balanceOf agrees──▶ paid
open/detected/partially_paid ──finalized block time > expires_at──▶ expired / expired_partially_paid (held)
any deposit with block_time > expires_at ──▶ held for the payer, never owed to the creator
paid ──settlement confirmed──▶ settled (F050)    held funds ──verified claim + approval──▶ refunded (later)
```
