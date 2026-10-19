# Backend architecture

The Go backend in `apps/backend`. Code rules: [rules.md](rules.md).
Requirements: the task's rows in [PROJECT.md](../PROJECT.md). Whole system: [architecture.md](../architecture.md).

Built: signup and profiles API, billing details, saved clients, balances, activity, wallet transactions and balance history API, invoice API, invoice and receipt PDFs (`internal/document`, drawn in Go from the stored invoice), Privy auth, watcher, ledger and signer, run by `api`, `worker` and `signer`; the gate
(`apps/backend/e2e`, R-23) runs the whole loop. Not built yet: refunds, webhooks, merchants.

Read only the sections your task touches:

| Section | Covers |
|---|---|
| [Processes](#processes) | What `api`, `worker`, `signer` and `canary` each do |
| [Startup](#startup) | What each process checks before it reports ready |
| [Scaling](#scaling) | Read caches, RPC and Postgres pools, rate limits |
| [Load test](#load-test) | The load test and what it measured |
| [Data model](#data-model) | Tables and columns, the `invoices_current` view, amounts, statuses, the ledger |
| [Privy](#privy) | Profile wallets from Privy; signup and profile creation |
| [Running the loop](#running-the-loop) | The chain list, RPC pools and roles for `worker` and `signer` |
| [Watcher](#watcher) | Scanning for deposits and wallet transfers, reorgs, the cursor |
| [Signer](#signer) | Settling paid invoices: nonces, fees, retries, refusals, [unresolved settles](#unresolved-settles) |
| [Invoice states](#invoice-states) | Booking deposits, payment and settlement status, final states |

## Processes
- `api`: public HTTP API + dashboard API. Verifies Privy tokens, authorizes the active profile,
  creates invoices, serves state. Reads profile wallet balances from each chain's second RPC at its finalized block
  (D-15, D-45), picked from the chain list like the worker's, through a short cache ([scaling](#scaling)). Holds **no**
  private keys: each process gets only its own secrets (`scripts/with-env.sh` drops the executor key for the api and
  worker). In production it listens on a private address behind the edge, never a public port, and every database
  URL uses `sslmode=verify-full`.
- `worker`: chain watcher (block cursor per chain, `eth_getLogs` for allowlisted tokens filtered
  to active receiver addresses), confirmation/finality tracking, reorg handling, invoice state
  machine and ledger booking, Check status rescans, payment reminders and retainer invoices (R-96, R-98), and the
  email from `outbox_events` after each round
  (`internal/notify`, R-80, R-82, R-84; only the worker holds `RESEND_API_KEY`, and without it nothing is sent). Webhooks come in
  PLAN 11.5.
  - It also keeps the ECB's reference rates (`internal/ecb`, R-110): at start, every 6 hours, 10 minutes after a failure.
  - It reads the ECB's 90-day file only, so rates from before its first read, or gaps over 90 days, never arrive.
  - Only tests set `ECB_RATES_URL`: the e2e gate points the worker at a fake ECB.
- `signer`: separate process, own credentials, no public routes, no user sessions. Accepts only
  typed intents ("settle invoice X") and signs only `factory.deploy` and `receiver.settle`. Refunds are never signed
  here: they will be Safe transactions the multisig owners approve (PLAN 11.10.3). Re-reads the ledger and the chain
  itself before signing, and settles at most `SponsoredPerDay` (50) invoices per user a day on the executor's gas.
  Writes settlement intents, the settlement ledger transaction and `settlement_status`. Every process uses one
  `DATABASE_URL` today; a separate signer database role is planned for deployment (Q-8).
- `canary`: run on its own host by a scheduler, not beside the others. Checks open invoices' receive addresses
  against `factory.predict` on two RPCs, the api and the pay page drawn in Chromium (address text and QR code), with
  its own config and no shared address code ([money safety](money-safety.md#canary), R-51).

## Startup

Each binary checks what it needs before it serves, and otherwise stops with one message naming the item (exit 1, D-71):
- `DATABASE_URL` answers within 10 s. The api then applies migrations. The worker and signer only read that every
  migration they embed is applied; if not, they stop and ask for the api to be started first (only the api migrates).
- Every chain enabled in the `chains` table is in the chain list and answers through a primary and a second RPC on
  different hosts (D-15), within 30 s per chain. A chain that can't is not skipped: the process stops, naming the chain
  and how many of its hosts answered. Disable the chain in the database or give it a second host (with
  `INFURA_API_KEYS` empty, only Arc Testnet lists two). The api checks too: it reads balances through the second RPC,
  and it stops when the factory has no code on an enabled chain, since invoices there could never settle.
- The signer: `EXECUTOR_PRIVATE_KEY` is a hex secp256k1 key (the error never shows it), and on every enabled chain the
  executor holds `settlement.MinGas` at the fee cap it would sign with now (twice the base fee plus the tip). `MinGas`
  is one receiver deploy (159,990 gas on Anvil) and one settle (at least `SettleGasFloor`), each plus a fifth: 342,000
  gas, 0.001026 ETH on Anvil (1 gwei base fee and tip). Below it the node would refuse the next deploy and settle. The
  message names the chain, the executor's address and its balance in whole coins. It is a floor derived from each
  chain's own price, not a budget: Arbitrum's L1 data cost is not in it. Tempo has no native coin and its RPC reports
  a placeholder balance: where Tempo's fee manager precompile exists, the check reads the executor's fee token instead
  (its choice in the fee manager, else PathUSD) and needs ceil(fee cap × `TempoMinGas` / 10^12) of its 6-decimal
  units, since Tempo prices gas in attodollars. `TempoMinGas` is 2,262,000: Tempo charges far more for creating
  contracts and storage, and its testnet deploy and settle used 1,305,758 and 572,845 gas.

Then each logs its ready line: `api listening`, `worker ready`, `signer ready`. The checks run once; an RPC failing
later is handled by the pool as before.

The worker and the signer each run as one copy. Before the checks each takes a Postgres session advisory lock
(`worker.LockKey`, `settlement.LockKey`) on a connection of its own and holds it for its lifetime. A second copy logs
`another worker is running; waiting` (or signer) every `POLL_INTERVAL` and takes over once the first exits: Postgres
frees the lock when its connection ends, a crash included. Before each round the holder pings that connection; if it
is gone, so is the lock, and the process stops rather than run beside the copy that takes over. Waiting instead of
exiting suits rolling deploys: the new copy starts as soon as the old one stops.

Root `pnpm dev` (`apps/backend/scripts/dev.sh`) stops at once when `EXECUTOR_PRIVATE_KEY` is missing or empty in
`apps/backend/.env`. It starts Postgres and builds the three binaries, starts the api and waits until it logs
`api listening` and `/healthz` answers 200, then starts the worker and signer, which need the api's migrations, and
waits for their ready lines. Each process has 120 s. When one stops or is not ready in time, the script names it,
stops the others and exits 1; the same when one stops later. Ctrl+C stops them all.

## Scaling

Deployment model (D-72): the api is stateless and runs as N replicas behind a load balancer; exactly one worker and
one signer run beside it (more copies wait on their locks, [startup](#startup)). Each api replica keeps its own
balance cache and rate-limit buckets in memory, so with N replicas the RPC reads and each caller's limit grow N times.
Redis is the next step when more than a few replicas run: the cache sits behind the `cache` interface in
`internal/balance`, with string keys and values so a Redis implementation can take its place; the limit buckets in
`internal/httpapi/mid` would move with it. Nothing else in the api keeps state between requests.

- Balance reads (`balance.ChainReader`): a chain's finalized block is read once per 3 s (`finalizedTTL`) for every
  request, then `balanceOf` once per chain, token, wallet and that block. Requests asking for the same key meanwhile
  wait for the one read. A balance is always the one at the block it is returned with (`finalizedBlock`), at most
  3 s behind the chain's. Values are kept 1 min (`balanceTTL`): a balance at a finalized block never changes, so this
  only frees memory. A failed read is not kept: the requests waiting for it get the error and the next request reads
  again. The read keeps the deadline of the request that started it but not its cancel, so one closed tab does not
  fail the others. `/balance-history` reads through the same cache, so a dashboard poll of both routes costs one
  `balanceOf` per token. The worker's paid check does not use it: it reads its own second-RPC balance.
- The RPC pool keeps up to 100 idle connections per host. With net/http's default of 2, each call beyond 2 at once
  opened a new connection (and TLS session), and under load the api ran out of local ports ([load test](#load-test)).
- Postgres: `pool_max_conns` in `DATABASE_URL` sets each process's pool (without it pgxpool takes the larger of 4 and
  the CPU count; `.env.example` sets 20). Keep the replicas' pools plus the worker's and signer's (each one more for
  its lock) under Postgres `max_connections` (100 by default). `database.Migrate` parses the URL as the pool does,
  so `pool_` parameters never reach Postgres as settings.
- Rate limits per user; public routes are limited at the edge: [api.md](api.md#rate-limits). On 429 the web waits and backs off.

## Load test

`pnpm --filter @forwend/backend loadtest -users=10000 -duration=3m` (`e2e/load_test.go`; needs Postgres and Foundry,
like the gate). Each user polls the dashboard routes every 15 s against Anvil behind a counting proxy; it prints
p50/p95/p99 per route, errors, unread balances and RPC calls per second. On 2026-10-10 (one Apple M4 Pro running
everything) 10,000 users gave p95 2.4 ms, 0 errors and 1,333 RPC calls/s (334 when the finalized block moves every
60 s). What keeps it there:

- RPC demand ≈ users × tokens ÷ max(15 s, how long a finalized block stays) + chains ÷ 3 s. It has to fit
  `RPC_RATE_PER_SECOND` times the second role's endpoints; batching `balanceOf` (Multicall) is the next step if not.
- `/balances` needs the `ledger_transactions_invoice` index (migration 00011): 21.5 ms without it, 0.37 ms with it.
- The RPC pool keeps up to 100 idle connections per host ([scaling](#scaling)).

Not covered: hosted RPC latency (tens of ms, not Anvil's 1 ms), separate machines, and load on the worker, signer and
Privy.

## Data model

Built in `internal/database/migrations` (R-17), except rows marked planned; Postgres enforces the rules below, each
with a test.

- `users(onboarded_at)` (set once by the first-run choice, R-50), `profiles(kind: personal|freelancer|merchant, name, idempotency_key, invoice_seq)` (one personal per user, made at
  signup without a key; other kinds once per user and key, or without a key by the first-run choice), `profile_wallets(provider, provider_wallet_id, address, chain_family)` (one per profile and family),
  `profile_billing_details(name, address, country, tax_id, contact_email, updated_at)` (at most one per profile, editable; R-43),
  `clients(name, email, address, country, tax_id, reference, reminders, updated_at)` (a profile's saved clients, editable, at
  most 1000 per profile, counted under the profile row lock; R-86).
- Planned (PLAN 11.1, 11.2): `merchants → stores(project_id, branding)`, `team_members(role, store scope)`.
- `chains(chain_id, chain_family, enabled)`, `tokens(chain_id, contract, decimals, enabled)`. One confirm rule for all
  chains (D-45), so no per-chain rule columns. From `00015` on, migrations add each planned network and its token
  switched off (Arbitrum Sepolia USDC in `00015`, Arc testnet USDC in `00016`, Tempo Moderato OUSD in `00017`), so
  test and fresh databases never need their RPCs or gas; Base Sepolia is still a row added by hand. A database turns
  one on (D-38) after the executor has gas there and the chain list has two working hosts for it:
  `UPDATE chains SET enabled = true WHERE chain_id = 421614; UPDATE tokens SET enabled = true WHERE chain_id = 421614;`
  Then restart the api, worker and signer so their startup checks cover it.
- `invoices`: immutable terms (`id` = the on-chain invoice id, profile, chain, token, `amount`, `expires_at` and
  `settle_deadline` as the contract's uint64 seconds, recipient, factory and receive address, `receive_method` (D-44)),
  separate **payment**, **settlement** and **refund** status columns, `idempotency_key` unique per profile with a
  SHA-256 `request_hash` of the create request. `number` is unique per profile, taken from `profiles.invoice_seq` by
  the insert trigger (D-50); it and the details (`title`, `note`, `due_date`, `client_name`, `client_email`,
  `client_address`, `client_country`, `client_tax_id`, `supply_date`, `reference`, and the agreed value's
  `agreed_currency`, `agreed_amount` in minor units, `agreed_decimals` and `agreed_date`, R-93) never change. A saved
  client is copied into these by the create request, not linked, so editing or deleting it changes no invoice (R-86).
  `invoice_lines(position, description, quantity, unit_price, amount)` (R-88, migration 00030) break a main row's amount
  down in its token's base units: inserted only in the transaction that makes the invoice, never updated or deleted, and
  a deferred constraint trigger checks at commit that they add up to the invoice's amount. The insert trigger also
  copies the profile's billing details into `issuer_name`, `issuer_address`, `issuer_country`, `issuer_tax_id` and
  `issuer_email` (all null without details), which never change either. Payer chooses (R-56, migration 00020): each
  further accepted option is a row with `main_id` = the invoice's first row, which must share its profile, recipient,
  factory, expiry, settle deadline and request; it takes the main row's number, no details and no issuer, and moves no
  counter (number and idempotency key are unique among main rows only), and only while the main row is open with no
  transfer (migration 00022). The main row's `chosen_id` names the option that received money first: set once, to one of
  its own options. The `invoices_current` view gives one row per invoice with the main row's number and details and the
  current option's terms and statuses.
- `chain_transfers`: `block_hash`, `block_number`, `block_time`, status `detected|confirmed|reorged`. A transfer must go to
  its invoice's receive address, for the invoice's token, on its chain (foreign key).
- `wallet_transfers` (R-38): enabled-token `Transfer` logs from or to a profile wallet, one row per wallet and direction
  (`in`|`out`) with the counterparty, so a transfer between two profile wallets is out for one and in for the other.
  Block fields, statuses and identity rules as in `chain_transfers`, with the wallet and direction in each key.
- `transfer_labels` (R-108): the user's label for money in that Forwend can't classify, one per profile and transfer
  log (chain, transaction, log index).
- `ecb_rates` (R-110, D-82): the ECB's daily euro reference rates, units per 1 EUR, one per currency and day.
  - A rate the ECB corrects replaces the kept one.
- `profiles.records_currency` is the profile's other records currency (R-110), null for none.
- `ledger_transactions` + `ledger_entries`: double-entry, append-only (below).
- `settlement_intents` (unique per invoice): nonce and tx hash tracked, with the hashes a fee replacement replaced;
  reconcile before any retry.
- `outbox_events`: `invoice.paid`, `invoice.held`, `invoice.settled` and `invoice.receipt`, queued by the ledger and
  the signer in the transaction that makes the change (`internal/outbox`), and `account.welcome` (with `user_id`, no
  invoice) when sign-up stores a new account's login email; sent once by the worker with retries
  ([api.md](api.md#notifications)). `invoice.sent` rows carry the request's `idempotency_key`: the owner sent the
  invoice to its client (R-94). `invoice.reminder` rows carry their `step` in the payload (R-96). `job.change` rows
  name a `job_id` (no invoice) and carry the change's key in the payload (R-107).
  `users.login_email` and `profiles.email_notifications` decide where and whether; `users.welcome` marks accounts made
  after welcome emails existed.
- `invoice_reminders`: one row per invoice once the owner first turns reminders on, with `enabled`, the client's
  `stop_token` and `stopped_at`.
- `jobs` (R-100): a quote with its link `token`, title, scope, a client copy and an issuer copy from billing details.
  It keeps the client's typed `accepted_name` and `accepted_email`, with `accepted_at`. `job_payments` is its schedule in cents.
  A payment marked done keeps `done_at` and an optional `delivery_link` (R-103).
  A scope change (R-105) has `proposed_at`, its `change_key` and `change_hash`, and the client's typed `accepted_*`.
  Each payment row gets its `invoice_id` once that invoice is made.
- `retainers` (R-98): an invoice that repeats every month, with the create `request` as JSON, `first_due`, `end_date`
  and `stopped_at`. `retainer_invoices` numbers each month's invoice from 0, so each month is made once.
- Planned (PLAN 11.5, 11.10): `refund_intents` (one per approved claim), `refund_claims`, `support_cases` (wrong chain,
  late), `webhook_endpoints`, `webhook_deliveries`.
- `chain_cursors(chain_id, last_scanned_block, last_finalized_block)`.

Rules:
- **Amounts**: domain `uint256` = `NUMERIC(78,0)` checked to 0…2^256−1 (the type alone accepts up to 10^78−1). Postgres
  rounds a fraction silently, so Go parses decimal strings into `big.Int` before any insert.
- **Addresses and hashes**: text with a `chain_family`; for `evm` only lowercase `0x` hex passes a CHECK. A mixed-case
  (EIP-55) copy would otherwise dodge the unique indexes. Lowercase in Go on the way in; checksum only for display.
- **Statuses**: text + CHECK, not Postgres enums (enum values can't be removed). A trigger enforces the allowed transitions ([Invoice states](#invoice-states)).
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
profile is still created and returned without a wallet (`walletAddress: null`). The next `POST /v1/me` retries every
profile's missing wallet: the personal one must succeed, the others share a `RepairBudget` (5 s) so a slow Privy
never holds the app's load.

## Running the loop

`worker` and `signer` read the shared chain list (`CHAINS_FILE`, `packages/contracts/chains.json`),
`INFURA_API_KEYS` and `RPC_RATE_PER_SECOND`, and serve the chains enabled in the `chains` table. `internal/chain` gives
each chain one pool of endpoints in `script/rpc.mjs` order: every Infura key (all on one host), then the public RPCs;
public RPCs only when `INFURA_API_KEYS` is empty. An endpoint is used only after its `eth_chainId` matches. Hosts
alternate between the two roles in list order (first host primary, second host second, third primary, ...), and a role
uses only its own hosts: the primary (reading the chain, signing) and the second (balances, D-15) never share a host,
even after an outage, so one provider can't supply both a deposit and the balance that confirms it. When all
of a role's hosts rest, that role waits; paid and settled wait with it. A list with fewer than two hosts is refused; every
chain lists at least two public hosts from different operators (the chain's own RPC, then publicnode or dRPC), so it
runs without Infura keys (`TestEveryChainListsTwoPublicHosts`). Every call, or batch, goes to its role's endpoint. No answer within 5 s, a connection error, an HTTP error
status or a rate-limit JSON-RPC error (429, -32005, -32007, or a message saying so) rests that endpoint (1 s doubled
per failure in a row, up to 5 min, half of it random) and sends the call to the next endpoint at once; when every
endpoint of the role rests, the call waits for the first one back if that comes before its deadline, else fails. Any
other answer, a revert or invalid params included, is the call's. Each endpoint gets at most `RPC_RATE_PER_SECOND`
calls a second per process, a batch counting each call. Errors and logs name an endpoint by host and position, never
by URL (an Infura URL holds the key). Each chain's round has a 2-minute limit. Every `POLL_INTERVAL` the worker runs, per chain, a watcher scan then the ledger; the
signer runs its due intents. The gate starts all three binaries against Postgres and Anvil (public RPCs only, the first
answering every third request with 429), creates an invoice through
the API, pays it and waits for detected → paid → settled with the deposit going detected → confirmed.

## Watcher

`internal/watcher` (R-20), one `Chain` per chain; never two at once for one chain (they would race on the cursor; the
worker's lock, [startup](#startup)).
Each `Scan` reads `latest`, then `eth_getLogs` for `Transfer` from the invoices' tokens to their receive addresses,
from `RescanDepth` (2,000) blocks below the last finalized block (or from the oldest `detected` row) to latest, so a
log one answer missed is read again for 15 minutes or more even where finalized is latest (Arc, Tempo), in ranges of at most
2,000 blocks; a range the RPC refuses for its rate (after every endpoint was tried) is read again in half, down to
50 blocks; one refused for its size is halved down to one block, and a single block still refused is read from
`eth_getBlockReceipts` and filtered the same way, so zero-value Transfer spam (gas only) can't stop the chain. The
range doubles back after each answer. One scan reads at most 40,000 blocks, so a long backlog (a
worker down for days) is caught up over several rounds, each recorded, instead of needing one round longer than its
timeout. Receive addresses and wallets go into topic lists of at most 1,000: go-ethereum nodes, Arbitrum's public RPC
among them, refuse more with "exceed max topics". Invoices leave the scan 30 days after their settle deadline (the
contracts' `MAX_HOLD`), unless a deposit to them is still detected: later money is moved only by the refund authority, from the chain. A transfer already recorded
under another block and then mined again is skipped with an `ALERT` log, so the chain's scan goes on.
Invoices on a chain are created only once the worker has its cursor (`ErrNotWatched`, 503): a first scan starts at the
finalized block and would never see a payment made before it. One JSON-RPC batch then reads `finalized` and the header of every block it judges, so they usually come
from one node. One transaction then:
- marks a `detected` row `reorged` only when the chain shows another block hash at its height; a log merely missing
  from one answer (a lagging or overloaded node) proves nothing;
- inserts each deposit whose block hash matches, `confirmed` when the block is at or below `finalized` (D-45), else
  `detected`; a `reorged` row whose block is canonical again comes back;
- moves `chain_cursors`, never below the last finalized block.
The same scan records profile-wallet transfers (R-38): `Transfer` logs of the chain's enabled tokens with any profile
wallet as sender, then as receiver (two `eth_getLogs` per range), one row per wallet side, by the deposit rules above
(detected, confirmed at or below `finalized`, reorged only when the chain shows another block at its height, a
re-mined copy gets a new row, the oldest detected row holds the scan's start). A token disabled while one of its
transfers is still detected stays in the scan until those rows confirm or are reorged, so they never hold the start;
its new transfers are not recorded. Start rule: a wallet's transfers are
recorded from the first scan that lists it, which reads from 2,000 blocks below the last finalized block. We make each
wallet before anyone can know its address and the next scan follows within one poll interval, so that is its whole
history; as for invoices, only a scan longer than 2,000 blocks could miss a transfer to a wallet made while it ran.
Transfers older than that window are not looked for: those of wallets made before this table existed, or before a
chain's first scan. Arc native-coin sends log no token `Transfer`, so they are not recorded.
Only the invoice's own
token counts, and the row stores the emitting contract, so the foreign key also rejects a look-alike. Block hashes and
times come from the RPC, never computed in Go. Arc's native-coin `Transfer` logs are ignored (see money-safety).
Scanning again changes nothing, so a restarted worker resumes from the cursor.

Check status (R-55) asks for a rescan of one invoice in `invoice_rechecks`. After each scan the worker takes up to
`watcher.RescanLimit` (5) asked invoices of the chain and reads their address's logs from the invoice's creation block
(found by a binary search over block times, a minute early for clock differences), at most `5 × MaxRange` blocks per
invoice per round, saving where it stopped, within its own 30 s (`worker.RescanTimeout`) so the ledger keeps its time.
What it finds is recorded like a scan, then booked by the ledger in the same round. A rescan never moves the chain's
cursor: that would let the regular scan skip blocks for the other invoices. An invoice outside the regular scan's watch
window (30 days after its settle deadline) is not rescanned: the request is dropped, since that money is the refund
authority's. One invoice's failing rescan does not hold up the others.

## Signer

`internal/settlement` (R-22), one `Signer` per executor key (the signer's lock, [startup](#startup)). When the ledger marks an invoice `paid` it queues one
settlement intent (unique per invoice) in the same transaction. Every transaction it signs uses the lower of the
primary and second RPC's suggested tips (D-15), so one host can't make the executor overpay. For each due intent the
signer:
1. If a settle is already saved (`sent`), finishes it first, whatever changed since.
   - The saved bytes must decode to `settle()` on this receiver on this chain with the saved hash.
   - A receipt for the saved hash or any version it replaced (`replaced_hashes`, same nonce, so at most one mines)
     decides first. Status 1 with the receiver's `Settled` log is our settle. It keeps that hash and is never signed
     again, whatever a lagging node says about `settled()` at latest.
   - Without a receipt, reads at one finalized block decide:
     - the receiver settled there while our nonce is unused there: another settler's work;
     - settled there with our nonce used there: can't be resolved yet. The intent stays `sent` with a reason and the
       growing wait of step 3 ([unresolved settles](#unresolved-settles));
     - our nonce used there while the receiver is not settled: ours was dropped.
   - Otherwise the saved bytes are sent again while their nonce is free and nobody settled.
   - Once `ReplaceAfter` (3 min) has passed since they were signed (`signed_at`), the same executor signs them again
     first, with:
     - the same nonce;
     - a gas limit no lower than the old one or a fresh estimate plus a fifth (on Arbitrum the L1 data cost can grow);
     - a higher fee: at least an eighth more tip and fee cap (geth wants a tenth) and at least what a new settle gets
       now, so the settles after it on the chain are not held up.
   - The new version is saved before it is sent, keeping the old hash.
   - A replacement whose fee cap would pass `MaxFeeFactor` (2) times a new settle's is not signed; the saved bytes are
     sent again as they are.
   - When the executor's next mined nonce has nothing pending and no saved settle holds it (a settle saved but never
     sent, then settled by the refund authority), a zero-value transfer to the executor fills it, so the settles after
     it can mine.
2. Otherwise re-reads the terms and refuses for good (`refused` with a reason, nothing sent) unless the invoice is
   `paid`, the recipient is the profile's wallet, the factory is the compiled one and the terms recompute the stored
   receive address; also when `factory.status` predicts another address.
3. Waits and retries (back to `pending` with a reason; 1 min doubling to 1 h) on temporary conditions:
   - wrong chain;
   - balance below the amount;
   - not settleable (paused);
   - a settle that reverted or was dropped while the receiver is not settled at the finalized block;
   - a settler other than this executor (the deadline passed: it sends nothing and waits for the refund authority's
     settle);
   - the invoice's user already had `SponsoredPerDay` (50) settlements signed in 24 hours, across all their profiles.
     Tiny invoices paid back and forth would otherwise drain the executor's gas for everyone. This logs an `ALERT`.
4. Deploys the receiver if needed (`deploy` is idempotent).
   - When a transaction we never saved waits at the executor's next mined nonce (an earlier deploy the fee left
     behind), the deploy takes that nonce at twice today's fee, so later transactions don't queue behind it.
   - Then waits up to 10 s for the RPC to show the receiver's code at the deploy's block or later (else the attempt
     ends and is tried again). A node that has not seen the deploy estimates settle as a call to an empty address,
     which runs out of gas.
   - Signs `settle()` with:
     - gas: the chain's own gas estimate, at the deploy's block when it deployed in this attempt (on Arbitrum that
       estimate counts the L1 data gas; a node that can't estimate at a block is asked at latest), at least
       `SettleGasFloor` (`TempoSettleGasFloor`, 580,000, on Tempo), plus a fifth;
     - nonce: the node's pending nonce, but never below the one after the deploy it just sent or after the last settle
       saved for this chain (a lagging node may not count them).
   - Saves sender, nonce, hash and signed bytes, then sends. After a crash it sends the same saved bytes again (same
     nonce, so at most one settle can be mined). The contract's `AlreadySettled` is a last guard.
5. Confirms once all of these hold:
   - `settled()` is true at the finalized block (D-45);
   - for our settle, its receipt's block is final too;
   - the chain's second RPC also reads `settled()` true at its own finalized block (D-15, as for paid).

   Then, in one transaction: intent `confirmed`, a `settlement` ledger transaction (receiver and recipient_payable
   each −amount; one per invoice) and the invoice's `settlement_status` `settled`. A settle a reorg drops before that
   is reconciled like an unsent one.
A waiting intent also stores its wait kind (`retry`, `cap` for the sponsored limit, `unresolved`), cleared when a
settle is signed, so the invoice API can tell the owner why the money waits (R-54) without reading the reason text.
Each intent's attempt has a 3-minute limit, so an RPC that stops answering can't stall the others. Before each intent
the signer checks it still holds its lock; without it the round stops.
It signs only `factory.deploy(terms)` and `receiver.settle()`, and only for chains enabled in the database: a chain
disabled there is dropped next round, and a round whose enabled list can't be read sends nothing. A receiver settled
outside our signer (the refund authority after the deadline) still confirms its intent, with no tx hash: a saved
settle keeps its hash only if its receipt succeeded with the `Settled` log. `retry` and `refuse` only change an intent still in the status
the attempt loaded.

### Unresolved settles

A sent settle with no receipt for any of its hashes while, at the finalized block, the receiver is settled and the
executor's nonce is used, can be ours behind a node that lags on receipts, or our nonce taken by another transaction.
The signer can't tell, so it keeps the intent `sent` with a reason and tries again after 2 min doubling to 1 h. To list
them:

```sql
SELECT si.invoice_id, i.chain_id, si.sender, si.nonce, si.tx_hash, si.replaced_hashes, si.reason, si.attempts,
       si.next_attempt_at
FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id
WHERE si.status = 'sent' AND si.reason IS NOT NULL
ORDER BY si.updated_at;
```

Refused intents (`status = 'refused'`) also carry their reason; waiting ones are `pending` with a reason.

## Invoice states

`internal/ledger` (R-21) runs after each scan, per invoice, in one transaction with the invoice row locked:
- Books each `confirmed`, not yet booked transfer in chain order: `receiver` gets the transfer amount; what is still
  owed up to the invoice amount goes to `recipient_payable`, the rest to `payer_held`. A late deposit (block time
  after `expires_at`) and any deposit after the invoice is final go entirely to `payer_held` (D-24, D-26).
- Payer chooses (D-76): an option's processing also locks its main row. When the first option gets a transfer, the option
  whose transfer that is not reorged came first on chain (block time, then block and log) becomes `chosen_id`; deposits on any other option are booked entirely to `payer_held`, as late money
  is, so that option is never paid or settled and expires like any invoice. A choice made on a detected transfer that
  a reorg later drops stays.
  - The worker reads chains one after another, so the choice waits until every other enabled option chain was read
    past that first transfer (`chain_cursors.last_scanned_time`, R-119), about one round. Until then nothing of the
    invoice is booked, and it stays `open`.
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
- `paid`, `expired`, `expired_partially_paid` and `canceled` are final (`ledger.Final`). Only the owner cancels, from
  `open` before any transfer (`invoice.Cancel`, R-79); every later deposit is held. A trigger rejects any other status
  change, any change to invoice terms, and an invoice created with any status but `open`.
- `GET /v1/invoices/{payToken}` lists deposits with `blocksLeft`/`secondsLeft` from the finalized block (R-28) and `blocksTotal`, the wait counted
  from the finalized block kept on the transfer row when it was first seen (`detected_finalized_block`, R-73).

```
open ──transfer seen──▶ detected ──booked < amount──▶ partially_paid ──booked ≥ amount and balanceOf agrees──▶ paid
open/detected/partially_paid ──finalized block time > expires_at──▶ expired / expired_partially_paid (held)
any deposit with block_time > expires_at ──▶ held for the payer, never owed to the creator
paid ──settlement confirmed──▶ settled    held funds ──verified claim + approval──▶ refunded (later)
```
