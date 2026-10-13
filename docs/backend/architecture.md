# Backend architecture

The Go backend in `apps/backend` (PLAN Phase 6). Code rules: [rules.md](rules.md).
Requirements: R-14…R-24 in [PROJECT.md](../PROJECT.md). Whole system: [architecture.md](../architecture.md).

Built: signup and profiles API, billing details, balances, activity, wallet transactions and balance history API, invoice API, invoice and receipt PDFs (`internal/document`, drawn in Go from the stored invoice), Privy auth, watcher, ledger and signer, run by `api`, `worker` and `signer`; the gate
(`apps/backend/e2e`, R-23) runs the whole loop. Not built yet: refunds, webhooks, merchants.

## Processes
- `api`: public HTTP API + dashboard API. Verifies Privy tokens, authorizes the active profile,
  creates invoices, serves state. Reads profile wallet balances from each chain's second RPC at its finalized block
  (D-15, D-45), picked from the chain list like the worker's, through a short cache ([scaling](#scaling)). Holds **no**
  private keys: each process gets only its own secrets (`scripts/with-env.sh` drops the executor key for the api and
  worker). In production it listens on a private address behind the edge, never a public port, and every database
  URL uses `sslmode=verify-full`.
- `worker`: chain watcher (block cursor per chain, `eth_getLogs` for allowlisted tokens filtered
  to active receiver addresses), confirmation/finality tracking, reorg handling, invoice state
  machine, outbox processing, webhook delivery, reconciliation.
- `signer`: separate process, own credentials, no public routes, no user sessions. Accepts only
  typed intents ("settle invoice X"). Refunds are not signed here: an approved claim becomes a
  proposed Safe transaction that the multisig owners approve. Re-reads the ledger and the chain
  itself before signing. Caps amounts, allows only known contract methods, writes its own audit
  log. Separate DB role with read access plus its own intent tables.
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
`internal/httpapi` would move with it. Nothing else in the api keeps state between requests.

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
like the gate). It starts Anvil with two tokens, a JWKS stand-in for Privy and the api, then seeds per user a personal
profile with a wallet, 5 paid invoices (one booked deposit each) and 10 wallet transfers. Every user then polls
`/v1/me`, `/balances`, `/balance-history`, `/transactions` and `/activity` at once every 15 s, starting at a random
moment in the first 15 s, while Anvil mines a block every `-block` (12 s; each block moves the finalized block). It
prints p50/p95/p99 per route, errors, `/balances` tokens whose wallet balance was not read, and RPC calls per second
counted at a proxy in front of Anvil. `RPC_RATE_PER_SECOND` is 100000, so the count is the api's demand, not the pace
limit. `-api=<binary>` tests another build: the before runs used origin/main at d2971b5
(`git archive d2971b5 apps/backend | tar -x -C <dir>`, then `go build ./cmd/api` there).

Run 2026-10-10 on an Apple M4 Pro (14 cores, 24 GB, macOS), Postgres 17 in Docker (14 CPUs, 8 GB), with the load
generator, api, proxy and Anvil on the same machine; default pool size (14 connections here). 10,000 users means
50,000 invoices, 100,000 ledger entries and 100,000 wallet transfers. All routes together, and `/balances` alone:

| Build | Users | Block every | p50 / p95 / p99, all | `/balances` p50 / p95 | Errors | Balances unread | RPC calls/s |
|---|---|---|---|---|---|---|---|
| before | 1,000 | 12 s | 3.4 / 11.8 / 16.4 ms | 6.7 / 14.1 ms | 0 | 0 | 533 |
| after | 1,000 | 12 s | 3.7 / 9.4 / 12.4 ms | 5.0 / 10.6 ms | 0 | 0 | 134 |
| before | 10,000 | 12 s | 40 / 73 / 80 s | 43 / 74 s | 170,918 of 211,410 | 6,305 of 12,842 | 145 got through of 5,333 asked |
| after | 10,000 | 12 s | 1.1 / 2.4 / 3.7 ms | 1.5 / 2.6 ms | 0 | 0 | 1,333 |
| after | 10,000 | 60 s | 1.0 / 2.1 / 3.6 ms | 1.3 / 2.3 ms | 0 | 0 | 334 |

- Before, each `/balances` and `/balance-history` request read the finalized block and `balanceOf` for every token:
  4 calls per user and token every 15 s, 5,333 calls/s at 10,000 users. The proxy and Anvil could not keep up: most
  calls got no answer within the pool's 5 s per attempt, the pool's client opened a new connection for each call
  beyond 2 at once until local ports ran out ("can't assign requested address"), and balance reads waited out their
  10 s. Postgres was over its limit too: 1,333 balance sums a second at 21 ms each (below) is about 28 CPU-seconds a
  second on 14 CPUs. Requests queued until the load generator's 60 s timeout; 6,305 of the 12,842 tokens answered
  had no wallet balance.
- After: one `balanceOf` per user and token per finalized block, and 60 finalized block reads in 3 minutes (one per
  3 s). When the block moves faster than users poll (12 s against 15 s) that is 4 times fewer calls; when it stays
  60 s, 16 times. RPC calls/s ≈ users × tokens ÷ max(15 s, how long a finalized block stays) + chains ÷ 3 s. The
  finalized block of Base and Arbitrum moves in steps as Ethereum finalizes, so real numbers are nearer the 60 s run.
  This demand has to fit `RPC_RATE_PER_SECOND` times the second role's endpoints; batching `balanceOf` calls
  (Multicall) is the next step if it does not.
- Postgres, `EXPLAIN ANALYZE` on the 10,000-user data: `/balances` took 21.5 ms, reading all 50,000
  `ledger_transactions` rows 4 times per request (sequential scans; no index on `invoice_id`). With
  `ledger_transactions_invoice` (migration 00011) it takes 0.37 ms. The other queries of these routes (activity,
  transactions, history, invoices list, `/v1/me`, the owner check) already used indexes and took 0.13 ms or less, so
  no other index was added.
- Not covered: Anvil answers in under 1 ms where a hosted RPC takes tens of ms, so real `/balances` misses are slower;
  one machine plays every part; the worker, the signer and Privy are not loaded.

## Data model

Built in `internal/database/migrations` (R-17); Postgres enforces the rules below, each with a test.

- `users(onboarded_at)` (set once by the first-run choice, R-50), `profiles(kind: personal|freelancer|merchant, name, idempotency_key, invoice_seq)` (one personal per user, made at
  signup without a key; other kinds once per user and key, or without a key by the first-run choice), `profile_wallets(provider, provider_wallet_id, address, chain_family)` (one per profile and family),
  `profile_billing_details(name, address, country, tax_id, contact_email, updated_at)` (at most one per profile, editable; R-43).
- `merchants → stores(project_id, branding)`, `team_members(role, store scope)` (Phase 11).
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
  `client_address`) never change. The insert trigger also copies the profile's billing details into `issuer_name`,
  `issuer_address`, `issuer_country`, `issuer_tax_id` and `issuer_email` (all null without details), which never
  change either.
- `chain_transfers`: `block_hash`, `block_number`, `block_time`, status `detected|confirmed|reorged`. A transfer must go to
  its invoice's receive address, for the invoice's token, on its chain (foreign key).
- `wallet_transfers` (R-38): enabled-token `Transfer` logs from or to a profile wallet, one row per wallet and direction
  (`in`|`out`) with the counterparty, so a transfer between two profile wallets is out for one and in for the other.
  Block fields, statuses and identity rules as in `chain_transfers`, with the wallet and direction in each key.
- `ledger_transactions` + `ledger_entries`: double-entry, append-only (below).
- `settlement_intents` (unique per invoice), `refund_intents` (one per approved claim); nonce and tx hash tracked,
  with the hashes a fee replacement replaced; reconcile before any retry.
- `refund_claims`, `support_cases` (wrong chain, late).
- `outbox_events` (written in the same transaction as the change, published at least once), `webhook_endpoints`,
  `webhook_deliveries` (Phase 11).
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
even after an outage, so one provider can't supply both a deposit and the balance that confirms it (SEC-01). When all
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
2,000 blocks; a range the RPC refuses for its size or rate (after every endpoint was tried) is read again in half, down to
50 blocks, and the range doubles back after each answer. One scan reads at most 40,000 blocks, so a long backlog (a
worker down for days) is caught up over several rounds, each recorded, instead of needing one round longer than its
timeout. Receive addresses and wallets go into topic lists of at most 1,000: go-ethereum nodes, Arbitrum's public RPC
among them, refuse more with "exceed max topics". Invoices leave the scan 30 days after their settle deadline (the
contracts' `MAX_HOLD`), unless a deposit to them is still detected: later money is moved only by the refund authority, from the chain. A transfer already recorded
under another block and then mined again is skipped with an `ALERT` log, so the chain's scan goes on.
Invoices on a chain are created only once the worker has its cursor (`ErrNotWatched`, 503): a first scan starts at the
finalized block and would never see a payment made before it (SEC-02). One JSON-RPC batch then reads `finalized` and the header of every block it judges, so they usually come
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
The 2,000-block rescan means one empty or lagging answer is never the last look at a final block. Only the invoice's own
token counts, and the row stores the emitting contract, so the foreign key also rejects a look-alike. Block hashes and
times come from the RPC, never computed in Go. Arc's native-coin `Transfer` logs are ignored (see money-safety). A
chain's first scan starts at its finalized block: deposits before it are not looked for. Scanning again changes
nothing, so a restarted worker resumes from the cursor.

## Signer

`internal/settlement` (R-22), one `Signer` per executor key (the signer's lock, [startup](#startup)). When the ledger marks an invoice `paid` it queues one
settlement intent (unique per invoice) in the same transaction. For each due intent the signer:
1. If a settle is already saved (`sent`), finishes it first, whatever changed since. The saved bytes must decode to
   `settle()` on this receiver on this chain with the saved hash. A receipt for the saved hash or any version it
   replaced (`replaced_hashes`, same nonce, so at most one mines) decides first: status 1 with the receiver's
   `Settled` log is our settle, which keeps that hash and is never signed again, whatever a lagging node says about
   `settled()` at latest. Without a receipt, reads at one finalized block decide: the receiver settled there while our
   nonce is unused there is another settler's work; settled there with our nonce used there can't be resolved yet: the
   intent stays `sent` with a reason and the growing wait of step 3 ([unresolved settles](#unresolved-settles)); our
   nonce used there while the receiver is not settled means ours was dropped. Otherwise the saved bytes are sent
   again while their nonce is free and nobody settled. Once `ReplaceAfter` (3 min) has passed since they were
   signed (`signed_at`), the same executor signs them again first with the same nonce, a gas limit no lower than the
   old one or a fresh estimate plus a fifth (on Arbitrum the L1 data cost can grow), and a higher fee: at
   least an eighth more tip and fee cap (geth wants a tenth) and at least what a new settle gets now, so the settles
   after it on the chain are not held up. The new version is saved before it is sent, keeping the old hash. A
   replacement whose fee cap would pass `MaxFeeFactor` (2) times a new settle's is not signed; the saved bytes are
   sent again as they are. When the executor's next mined nonce has nothing pending and no saved settle holds it (a
   settle saved but never sent, then settled by the refund authority), a zero-value transfer to the executor fills
   it, so the settles after it can mine.
2. Otherwise re-reads the terms and refuses for good (`refused` with a reason, nothing sent) unless the invoice is
   `paid`, the recipient is the profile's wallet, the factory is the compiled one and the terms recompute the stored
   receive address; also when `factory.status` predicts another address.
3. Waits and retries (back to `pending` with a reason; 1 min doubling to 1 h) on temporary conditions: wrong chain,
   balance below the amount, not settleable (paused), a settle that reverted or was dropped while the receiver is
   not settled at the finalized block, or a settler other than this executor (the deadline passed: it sends nothing
   and waits for the refund authority's settle). Also when the invoice's user already had `SponsoredPerDay` (50)
   settlements signed in 24 hours, across all their profiles: tiny invoices paid back and forth would otherwise drain
   the executor's gas for everyone (SEC-03); this logs an `ALERT`.
4. Deploys the receiver if needed (`deploy` is idempotent). When a transaction we never saved waits at the executor's
   next mined nonce (an earlier deploy the fee left behind), the deploy takes that nonce at twice today's fee, so later
   transactions don't queue behind it. Then waits up to 10 s for the RPC to show the receiver's
   code at the deploy's block or later (else the attempt ends and is tried again): a node that has not seen the
   deploy estimates settle as a call to an empty address, which runs out of gas. Signs `settle()` with the chain's
   own gas estimate, at the deploy's block when it deployed in this attempt (on Arbitrum that estimate counts the L1
   data gas; a node that can't estimate at a block is asked at latest), at least `SettleGasFloor` (`TempoSettleGasFloor`,
   580,000, on Tempo), plus a fifth, at
   the node's pending nonce but never below the one
   after the deploy it just sent or after the last settle saved for this chain (a lagging node may not count them).
   Saves sender, nonce, hash and signed bytes, then sends. After a crash it sends the same saved bytes again (same
   nonce, so at most one settle can be mined). The contract's `AlreadySettled` is a last guard.
5. Once `settled()` is true at the finalized block (D-45), and for our settle once its receipt's block is final too,
   and the chain's second RPC also reads `settled()` true at its own finalized block (D-15, as for paid), in one
   transaction: intent `confirmed`, a `settlement` ledger transaction (receiver and recipient_payable each
   −amount; one per invoice) and the invoice's `settlement_status` `settled`. A settle a reorg drops before that is
   reconciled like an unsent one.
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
