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
  creates invoices, serves state. Reads profile wallet balances from each chain's RPC pool at its finalized block
  (D-15, D-45), configured through the same registry as the worker's, through a short cache ([scaling](#scaling)). Holds **no**
  private keys: each process gets only its own secrets (`scripts/with-env.sh` drops the executor key for the api and
  worker). In production it listens on a private address behind the edge, never a public port, and every database
  URL uses `sslmode=verify-full`.
- `worker`: chain watcher (block cursor per chain, `eth_getLogs` for allowlisted tokens filtered
  to active receiver addresses), confirmation/finality tracking, reorg handling, invoice state
  machine and ledger booking, Check status rescans, payment reminders and retainer invoices (R-96, R-98), and the
  email from `outbox_events`
  (`internal/notify`, R-80, R-82, R-84). The worker and the api hold `RESEND_API_KEY`, the api for Confirm it's you
  codes (R-137); without it nothing is sent.
  - Reminders, retainers, email, ECB rates and prices run on a loop beside the chain rounds, at the same interval.
    A slow Resend, ECB or CoinGecko answer never delays a round.
  - Every 5 minutes it logs an `ALERT` for symptoms that hold money (R-180):
    - a chain whose finalized cursor is over 45 minutes behind the clock;
    - a deposit still detected below the finalized block after 45 minutes;
    - a receiver's settle or refund the ledger hasn't booked after 30 minutes, with the reason (R-184);
    - an invoice owed in full but not paid 45 minutes after its last booking: its finalized balance check keeps failing;
    - a paid invoice not settled within 30 minutes, or within a day of its settle deadline, until that deadline.
      - One waiting at its user's daily settlement cap alerts only within that day.
  - A round books money already recorded even when its own scan fails (R-184).
  - Each round checks the finalized balance of every invoice owed in full and not yet paid.
  - It also keeps the ECB's reference rates (`internal/ecb`, R-110): at start, every 6 hours, 10 minutes after a failure.
  - It reads the ECB's 90-day file only, so rates from before its first read, or gaps over 90 days, never arrive.
  - Only tests set `ECB_RATES_URL`: the e2e gate points the worker at a fake ECB.
  - It keeps NEAR Intents 1Click's token list in `intents_tokens` (`internal/intents`, R-232): at start, every 10
    minutes, 2 minutes after a failure. A token 1Click drops is removed. Only tests set `ONECLICK_API_URL`.
  - On a loop of its own it reads the 1Click status of each quote due for a check, 20 a round (R-234).
    - It writes what changed to `crosschain_quotes` and the history; it never decides paid.
    - The alerts every 5 minutes include cross-chain payments that hold a payer's money.
  - It keeps CoinGecko's USD prices of the stablecoins for display (`internal/price`, R-178, D-115).
    - It reads them at start, every 15 minutes (`COINGECKO_INTERVAL`), and 2 minutes after a failure.
    - A read times out after 10 s; a redirect or an answer over 64 KiB fails it.
    - It sends `COINGECKO_API_KEY`, a Demo plan key, when set; only the worker holds it.
    - A coin the answer gives no price keeps its last one, which turns stale.
    - Only tests set `COINGECKO_API_URL`: the e2e gate points the worker at a fake CoinGecko.
- `signer`: separate process, own credentials, no public routes, no user sessions. Accepts only
  typed intents ("settle invoice X") and signs only `factory.deploy` and `receiver.settle`, plus the USDC approve and
  Uniswap swap that buy its own gas (R-229). Refunds are never signed
  here: they will be Safe transactions the multisig owners approve (PLAN 11.10.3). Re-reads the ledger and the chain
  itself before signing, and settles at most `SponsoredPerDay` (50) invoices per user a day on the executor's gas.
  Writes settlement intents, the settlement ledger transaction and `settlement_status`. Every process uses one
  `DATABASE_URL` today; a separate signer database role is planned for deployment (Q-8).
- `webhooks`: runs 16 independent delivery workers (R-148, R-175).
  - Idle workers wait for one shared poll, which checks every second for a due delivery and wakes them.
  - It holds only `DATABASE_URL` and `WEBHOOK_SECRET_KEY`.
  - Owners choose endpoint URLs, so the sender gets no signer, Privy, email or RPC key.
  - Its client checks the address after DNS (`webhook.Client`); without the key it sends nothing.
  - Delivery leases last one minute.
  - Profile scheduling locks enforce two active attempts per profile and one per endpoint across replicas.
  - Profiles rotate by their last claim time. A crash releases capacity when its leases expire.
- `canary`: run on its own host by a scheduler, not beside the others. Checks open invoices' receive addresses
  against `factory.predict` on two RPCs, the api and the pay page drawn in Chromium (address text and QR code), with
  its own config and no shared address code ([money safety](money-safety.md#canary), R-51).
- `ops`: support's command for held money, run by hand on a server with the database and RPCs (PLAN 11.10.3).
  It reads cases and queues returns, and holds no key ([returns through support](money-safety.md#returns-through-support)).

## Startup

Each binary checks what it needs before it serves. A setup mistake stops it with one message naming the item (exit 1,
D-71); a chain whose RPCs don't answer is logged and skipped:
- `DATABASE_URL` answers within 10 s. The api then applies migrations. The worker, signer and webhooks sender only read
  that every migration they embed is applied; if not, they stop and ask for the api to be started first (only the api migrates).
- With `ENABLE_TESTNET_USDC=1`, the API then enables the three USDC testnet pairs before chain checks.
  - Dokploy defaults to 1. Local development leaves it off; `0` leaves existing network settings unchanged.
  - Repeated startup enables those pairs again. Other pairs keep their settings; see [staging](../staging.md#dokploy-staging).
- With `ENABLE_MAINNETS` set, it then switches the named live chains on, all or none.
  - An ID that is not a live chain stops startup and switches nothing on. Empty leaves the chains as they are.
- Every enabled chain has validated endpoint metadata and at least one answering endpoint (D-15), within 30 s per chain.
  - A mistake stops the process when endpoint metadata is missing or every configured endpoint serves another chain.
    Fix the metadata or disable that chain.
  - A chain whose hosts don't answer, or refuse us (HTTP 401, 403 or 404), is an outage, not a mistake (D-71). The
    process logs `chain unavailable at startup` with the chain and how many of its hosts answered, and starts.
  - Its factory and gas checks (below) don't run then. Restart the process once the chain answers, so they do.
  - The pool then rides it out as it rides out any outage: requests rest the hosts that fail and use the next one.
    One working endpoint can provide finalized evidence for payment and settlement.
- The API reads factory code through the same failover pool. No code
  on an enabled chain, or no answer from either, stops it: invoices there could never settle.
- The signer: `EXECUTOR_PRIVATE_KEY` is a hex secp256k1 key (the error never shows it), and on every enabled chain the
  executor holds `settlement.MinGas` at the fee cap it would sign with now (twice the base fee plus the tip). `MinGas`
  is one receiver deploy (159,990 gas on Anvil) and one settle (at least `SettleGasFloor`), each plus a fifth: 342,000
  gas, 0.001026 ETH on Anvil (1 gwei base fee and tip). Below it the node would refuse the next deploy and settle. The
  message names the chain, the executor's address and its balance in whole coins. A read that fails on the primary is
  retried through the endpoint pool; a shortfall stops it at once. It is a floor derived from each chain's own price, not a
  budget: Arbitrum's L1 data cost is not in it. Tempo has no native coin and its RPC reports a placeholder balance:
  where Tempo's fee manager precompile exists, the check reads the executor's fee token instead (its choice in the fee
  manager, else PathUSD) and needs ceil(fee cap × `TempoMinGas` / 10^12) of its 6-decimal units, since Tempo prices
  gas in attodollars. `TempoMinGas` is 2,262,000: Tempo charges far more for creating contracts and storage, and its
  v1 testnet deploy and settle used 1,305,758 and 572,845 gas.
  - Every 5 minutes the signer checks again for `GasAlertSettlements` (20) deploys and settles (R-189).
    - Below that it logs `ALERT executor gas runs low`, long before it can't pay a settle.
  - On Arc and Tempo the network fees the executor is paid are its gas (R-229).
    - Arc's gas coin is its USDC; the executor's Tempo fee token is OUSD, set in Tempo's fee manager.
  - On Base and Arbitrum, below the 20, the signer first buys ether with the USDC fees it holds (R-229).
    - It swaps in Uniswap v3's USDC/WETH 0.05% pool through SwapRouter02 (`settlement.swapRoutes`).
    - It tops up to 40 deploys and settles' worth at the current fee cap, or spends all its USDC if that buys less.
    - One router `multicall` swaps and unwraps the WETH; it reverts unless it pays the Chainlink price less 1%.
    - A stale price, or one read while the L2 sequencer is down or just back, sends no swap (`chain.EthPrice`).
    - The approve allows only that swap's USDC.
    - An allowance a refused swap left is swapped first if it buys enough alone; a smaller one is replaced.
    - It skips a swap that buys less than one deploy and settle, so dust sent to the executor is never approved.
    - A swap its gas estimate refuses is never sent. One that reverts after the estimate costs its gas.
    - It buys nothing while one of the executor's transactions waits to be mined.
    - A failed or refused swap adds its reason to the alert; settlement waits as before.
    - `go test -tags mainnetfork` runs it on forks of both mainnets through their public RPCs.
  - No fee it signs exceeds the chain's ceiling per gas unit (`settlement.maxFeePerGas`), whatever a provider suggests.
    - Base and Arbitrum Sepolia: 1 gwei. Arc: 1,000 gwei. Tempo: 100 gwei (attodollars). Fees in October 2026 were far below.
    - Replacements and stuck-deploy replacements stop at it too; above it a settlement waits and its delay alert fires.
    - A chain without a ceiling fails the start-up check, so the signer never serves it unbounded.

Then each logs its ready line: `api listening`, `worker ready`, `signer ready`. The checks run once; an RPC failing
later is handled by the pool as before.

The worker and the signer each run as one copy. Before the checks each takes a Postgres session advisory lock
(`worker.LockKey`, `settlement.LockKey`) on a connection of its own and holds it for its lifetime. A second copy logs
`another worker is running; waiting` (or signer) every `POLL_INTERVAL` and takes over once the first exits: Postgres
frees the lock when its connection ends, a crash included. Before each round the holder pings that connection; if it
is gone, so is the lock, and the process stops rather than run beside the copy that takes over. Waiting instead of
exiting suits rolling deploys: the new copy starts as soon as the old one stops.

Root `pnpm dev` (`apps/backend/scripts/dev.sh`) stops at once when `EXECUTOR_PRIVATE_KEY` is missing or empty in
`apps/backend/.env`. It starts Postgres, builds the four binaries and starts the api. Once the api logs `api listening`
and `/healthz` answers 200, it starts the worker, signer and webhooks, which need its migrations. Then it waits for their
ready lines. Each process has 120 s. When one stops or is not ready in time, the script names it,
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
  `balanceOf` per token. The worker reads finalized balances through the selected provider, sharing one finalized header within each chain round.
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
  the endpoint limits and shared weighted budget described below. These figures exclude worker and signer traffic.
- `/balances` needs the `ledger_transactions_invoice` index (migration 00011): 21.5 ms without it, 0.37 ms with it.
- `/balances` and activity deposits find a profile's invoice rows through `invoices_profile` (migration 00088).
  - With 220,000 invoices, a profile without payments read its balances in 0.05 ms, not 19 ms.
- The RPC pool keeps up to 100 idle connections per host ([scaling](#scaling)).

Not covered: hosted RPC latency (tens of ms, not Anvil's 1 ms), separate machines, and load on the worker, signer and
Privy.

## Data model

Built in `internal/database/migrations` (R-17), except rows marked planned; Postgres enforces the rules below, each
with a test.

- `users(onboarded_at, sessions_revoked_at)` (set once by the first-run choice, R-50; Sign out everywhere's cutoff, R-137), `profiles(kind: personal|freelancer|merchant, name, idempotency_key, invoice_seq)` (one personal per user, made at
  signup without a key; other kinds once per user and key, or without a key by the first-run choice), `profile_wallets(provider, provider_wallet_id, address, chain_family)` (one per profile and family),
  `profile_billing_details(name, address, country, tax_id, contact_email, updated_at)` (at most one per profile, editable; R-43),
  `clients(name, email, address, country, tax_id, reference, reminders, updated_at)` (a profile's saved clients, editable, at
  most 1000 per profile, counted under the profile row lock; R-86).
- `stores(name, default_expires_in, allowed_origins, brand_color, logo, logo_at, updated_at)`: a merchant profile's
  stores (R-134). `logo` is a PNG the API encoded from an upload of at most 1 MB; the PNG itself can reach about
  4.2 MB (R-135).
  - The first is made with the profile by a trigger; at most 20 per profile, counted under the profile row lock.
  - Its id is the project ID (D-31). `invoices.store_id` names a store of the same profile and never changes.
- `profile_tokens_off(profile_id, chain_id, token_contract)` and `store_tokens_off(store_id, …)`: tokens turned off
  for new invoices (R-136). An enabled token is on until it has a row here.
- `profile_members(profile_id, user_id, role: admin|developer|finance)` and `member_stores(profile_id, user_id,
  store_id)`: a merchant profile's team (R-138). A trigger keeps members to merchant profiles, never the owner.
- `payment_links(profile_id, store_id, slug, title, amount_cents | min_cents, max_cents, ends_at, max_payments, active,
  visits)` (R-140). Amounts are USD cents. `invoices.link_id` names the link an invoice was made from.
  - A payer's Pay makes that invoice through `invoice.Create`, with its key under the link's own prefix (R-142).
- `api_keys(profile_id, store_id, name, livemode, secret_hash, last4, scopes, created_by, last_used_at, expires_at,
  revoked_at)` (R-144). Only the SHA-256 of a key's text is kept; a rolled key works until `expires_at`.
- `webhook_endpoints(profile_id, store_id, url, description, events, enabled, livemode)` and
  `webhook_secrets(endpoint_id, sealed, expires_at)` (R-146). A secret is AES-256-GCM under `WEBHOOK_SECRET_KEY`, its
  endpoint's id as the associated data, so a sealed secret copied to another endpoint does not open.
- `webhook_events(history_id, profile_id, invoice_id, type, livemode, sequence)` and `webhook_deliveries(endpoint_id,
  event_id)` (R-147). `history.Add` writes both with the history row, so an event can't miss a change.
  - Events are append-only. The key `(invoice_id, sequence)` stops two writers that skip the invoice's lock.
- A delivery also keeps `status`, `attempts`, `next_attempt_at`, `leased_until` and the `body` first sent (R-148, R-175).
  - `webhook_delivery_profiles` stores the last claim time and serializes profile claims and manual queue changes.
  - `webhook_attempts(endpoint_id, event_id, status_code, error, duration_ms)` logs each attempt.
  - A `webhook.test` event (R-149) has no history row, invoice or sequence; a check ties those to its type.
  - `outbox_events.endpoint_id` names the endpoint of a `webhook.disabled` email.
- `profile_invites(profile_id, email, role, stores, token_hash, expires_at, accepted_at, revoked_at)` (R-139).
  - `token_hash` is the SHA-256 of the link's token; the token itself is never kept here.
  - One open invite per address and profile (a unique index); a new one revokes the last.
- `chains(chain_id, chain_family, enabled, livemode)`, `tokens(chain_id, contract, decimals, enabled)`. `livemode` is
  false unless whatever adds a chain says live: the testnets are test mode (D-87, R-143). One confirm rule for all
  chains (D-45), so no per-chain rule columns. From `00015` on, migrations add each planned network and its token
  switched off (Arbitrum Sepolia USDC in `00015`, Arc testnet USDC in `00016`, Tempo Moderato OUSD in `00017`), so
  isolated tests need no public RPCs or testnet gas. Migration 82 adds Base Sepolia disabled, with public RPC metadata. Activation below adds its token.
  An operator can enable another pair after the executor has gas and the endpoint registry has at least one working provider:
  `UPDATE chains SET enabled = true WHERE chain_id = 421614; UPDATE tokens SET enabled = true WHERE chain_id = 421614;`
  Then restart the api, worker and signer so their startup checks cover it. A chain they log as unavailable at
  startup is not checked yet: restart them again once it answers.
  - Migrations 105 and 106 add the mainnets, live mode and switched off, and their enabled tokens. `ENABLE_MAINNETS` switches each chain on.
  - With `ENABLE_TESTNET_USDC=1`, startup adds Base Sepolia and enables its USDC alongside Arbitrum Sepolia and Arc Testnet USDC.
  - This activation runs after migrations on fresh and existing databases. Schema migrations alone still leave the pairs disabled.
- `profiles.livemode` is the profile's mode (D-120): false while Developer mode is on.
  - A trigger starts a new profile live when a mainnet is switched on, else in test mode.
- `invoices`: immutable terms (`id` = the on-chain invoice id, profile, chain, token, `amount`, `expires_at` and
  `settle_deadline` as the contract's uint64 seconds, recipient, factory and receive address, `receive_method` (D-44),
  `network_fee` and `platform_fee`, 0 by default and at most a tenth of the amount together (R-226), and `fees_paid_by`,
  `owner` or `client` (D-122)),
  separate **payment**, **settlement** and **refund** status columns, `idempotency_key` unique per profile with a
  SHA-256 `request_hash` of the create request. `number` is unique per profile, taken from `profiles.invoice_seq` by
  the insert trigger (D-50). A payment-link invoice has a null `number` until the ledger books its first deposit (R-141).
  Once set, the number and the details (`title`, `client_name`, `client_address`, `client_country`,
  `client_tax_id`, `supply_date`, and the agreed value's `agreed_currency`, `agreed_amount` in minor units,
  `agreed_decimals` and `agreed_date`, R-93) never change. `client_email`, `return_url` and the owner's `memo` change
  at any time (R-127); `note`, `reference` and `due_date` only before any money (R-128). A saved
  client is copied into these by the create request, not linked, so editing or deleting it changes no invoice (R-86).
  `reopened_until` holds a reopen's close (R-130); the generated `closes_at` is the close every reader uses.
  `receiver_deployed_at` caches verified deployment state; positive deployment evidence survives historical scans.
  An early deployment can shorten `closes_at` without changing signed terms.
  A changed operational close records `checkout.close_changed` with the option and new close.
  `invoice_lines(position, description, quantity, unit_price, amount)` (R-88, migration 00030) break a main row's amount
  down in its token's base units: inserted only in the transaction that makes the invoice, never updated or deleted, and
  a deferred constraint trigger checks at commit that they add up to the invoice's amount. The insert trigger also
  copies the profile's billing details into `issuer_name`, `issuer_address`, `issuer_country`, `issuer_tax_id` and
  `issuer_email` (all null without details), which never change either. Payer chooses (R-56, migration 00020): each
  further accepted option is a row with `main_id` = the invoice's first row, which must share its profile, recipient,
  factory, expiry, settle deadline and request; it takes the main row's number, no details and no issuer, and moves no
  counter (number and idempotency key are unique among main rows only), and only while the main row is open with no
  transfer (migration 00022). The main row's `chosen_id` names the option that received money first: set once, to one of
  its own options. Its `picked_id` is the option the payer last showed the address for (R-57); it
  decides nothing. The `invoices_current` view gives one row per invoice with the main row's number and details and the
  current option's terms and statuses.
- `chain_transfers`: `block_hash`, `block_number`, `block_time`, status `detected|confirmed|reorged`. A transfer must go to
  its invoice's receive address, for the invoice's token, on its chain (foreign key).
- `wallet_transfers` (R-38): enabled-token `Transfer` logs from or to a profile wallet, one row per wallet and direction
  (`in`|`out`) with the counterparty, so a transfer between two profile wallets is out for one and in for the other.
  Block fields, statuses and identity rules as in `chain_transfers`, with the wallet and direction in each key.
- `sends` (R-211, R-212): a send out of a profile wallet, from prepared to sent, failed, canceled or expired. One
  unsigned send per wallet and chain, and one send per hash. `wallet_transfers` decides sent; the hash only links them.
- `fresh_sign_ins` (R-137, D-49): an emailed Confirm it's you code per Privy session, hashed, with tries and expiry.
  A confirmed row makes its session fresh for 15 minutes.
- `tokens.native_gas`: the token is its chain's gas coin (Arc USDC), so a send of it can pay its own gas (R-216).
- `tokens.fee_asset`: the Privy user-pays asset a send of the token pays its fee in, through Privy's paymaster (R-225).
  - Set to match the Privy dashboard's custom gas payment tokens: `usdc` on Base, Arbitrum and their testnets.
- `sends.fee_asset` and `sends.privy_transaction_id`: a paymaster send, and the Privy transaction that carries it.
  - Its hash is NULL until Privy gives it; nothing else sets it (D-49).
  - A paymaster's fee Transfer in a send's transaction is not money sent: activity hides it and it tells nobody (R-224).
    - Only within 3 times the quoted fee all together, in a transaction that also moves the send (`chain.PaymasterFee`).
  - The balance history still counts it, as the balance does.
- `transfer_labels` (R-108): the user's label for money in that Forwend can't classify, one per profile and transfer
  log (chain, transaction, log index).
- `ecb_rates` (R-110, D-82): the ECB's daily euro reference rates, units per 1 EUR, one per currency and day.
  - A rate the ECB corrects replaces the kept one.
- `coin_prices` (R-178, D-115): CoinGecko's USD price per coin, with its source time and the worker's read time.
- `profiles.records_currency` is the profile's other records currency (R-110), null for none.
- `profiles.fees_paid_by` is who pays new invoices' fees unless one says otherwise (D-122); `payment_links.fees_paid_by`
  overrides it for a link's invoices, null keeping the profile's.
- `ledger_transactions` + `ledger_entries`: double-entry, append-only (below).
- `settlement_intents` (unique per invoice): nonce and tx hash tracked, with the hashes a fee replacement replaced;
  reconcile before any retry.
- `receiver_outflows` preserves actual receiver events, exact outgoing transfer identity and once-only journal attribution.
  - The chain's scan records them; the signer also records its own settle from its receipt.
- These records remain separate from signer intents, webhook delivery and merchant financial classification.
- `outbox_events`: `invoice.paid`, `invoice.held`, `invoice.settled` and `invoice.receipt`, queued by the ledger and
  the signer in the transaction that makes the change (`internal/outbox`), and `account.welcome` (with `user_id`, no
  invoice) when sign-up stores a new account's login email; sent once by the worker with retries
  ([api.md](api.md#notifications)). `invoice.sent` rows carry the request's `idempotency_key`: the owner sent the
  invoice to its client (R-94). `invoice.reminder` rows carry their `step` in the payload (R-96). `job.change` rows
  name a `job_id` (no invoice) and carry the change's key in the payload (R-107). `team.invite` rows name an
  `invite_id` and carry the link's token until the worker sends the email or gives up, then drop it (R-139).
  `users.login_email` and `profiles.email_notifications` decide where and whether; `users.welcome` marks accounts made
  after welcome emails existed.
  - `wallet.outflow` rows name a `wallet_transfer_id`: money left a profile wallet with no approved send (D-49).
  - `settlement.waiting` rows name one invoice the daily settle cap holds back: one email a day per user (SEC-03).
- `history_events` (R-123, D-92): what happened to each invoice, one row per change.
  - `history.Add` writes it in the transaction that makes the change.
  - A row has the main invoice, `kind`, `actor` (`owner`, `payer` or `system`), `at` and small `data`.
  - Only the option an invoice shows writes its status; an option not chosen adds only money held on it.
  - Append-only like the ledger.
  - Rows marked `backfilled` were made from older invoices' timestamps.
- `invoice_views` (R-125): pay page loads per invoice: a count, the first and the last time.
- `invoice_reminders`: one row per invoice once the owner first turns reminders on, with `enabled`, the client's
  `stop_token` and `stopped_at`.
- `jobs` (R-100): a quote with its link `token`, title, scope, a client copy and an issuer copy from billing details.
  - `livemode` is the profile's mode when it was quoted; every invoice of the job is of it (R-221).
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

- API, worker and signer load enabled chains and endpoint metadata from Postgres at startup.
- [RPC operations](rpc.md) defines configuration, secret references, routing, recovery, migration and the deferred architecture.
- `internal/chain` owns configuration validation and go-ethereum client construction.
- Payment services receive resolved chain specifications; they never read secrets or construct provider URLs.
- Each chain has one pool containing all enabled endpoints; legacy role labels do not restrict routing.
- Private endpoints precede public endpoints; then the fastest measured answer wins ([routing](rpc.md#routing-and-health)).
- An endpoint that refuses a request's size passes it to the next one; priority orders only unmeasured endpoints.
- Each request tries each eligible endpoint once, bounded by its caller deadline and a 30-second transport deadline.
- HTTP exchanges have a five-second timeout; exhausted groups return a controlled unavailable error.
- Failed endpoints cool down with exponential jitter; one recovery probe validates them before reuse.
- Health checks validate chain identity, latest-head freshness and finalized-header support.
- Error responses retain codes and safe categories; provider text, URLs and error data cannot enter logs or public errors.
- Node-managed signing and unknown RPC methods are refused; signed transaction retries retain identical bytes.
- Every batch stays together on one endpoint per attempt.
- API, worker and signer also share a weighted budget in PostgreSQL (`rpc_budgets`, R-133).
- Its rate is `RPC_RATE_PER_SECOND × 80` units per second.
- Ordinary calls cost 80 units; `eth_chainId` costs 5, logs 255, gas estimates 300, and block receipts 1,000.
- These conservative weights are pacing units, not provider billing prices.
- Endpoints with the same configured `budget_group` share one bucket across chains and processes.
- Only hashed budget-group identifiers enter the budget table; URLs and credentials never enter its rows or logs.
- Every attempt and chain-ID probe takes budget; waiting releases the database connection.
- Budget exhaustion or a database failure stops the request without marking the provider unhealthy.
- The budget uses a separate two-connection pool because ledger reads can hold invoice transactions.
- Related header batches retry together to preserve their provider view.
- The watcher sends single reads as ordinary RPC requests; only multiple reads use batch requests.
- Every `POLL_INTERVAL`, worker and signer start a job for each enabled, idle chain.
- Busy chains keep their own jobs; healthy chains can complete more rounds meanwhile.
- Each worker chain job has a two-minute deadline.
- Disabling a chain cancels its job; shutdown cancels and joins jobs before closing their connections.

The gate starts all three binaries against Postgres and Anvil (public RPCs only, the first
answering every third request with 429), creates an invoice through
the API, pays it and waits for detected → paid → settled with the deposit going detected → confirmed.

## Watcher

- `internal/watcher` (R-20) runs one active job and one historical job per chain under the [worker lock](#startup).
- Separate watcher objects keep range adaptation local; only active jobs advance the fast cursor.
- Historical work shares provider capacity but does not delay ledger scheduling until it completes.
- The same ranges also read the watched receivers' settle, refund and recover events ([receiver movements](money-safety.md#receiver-movements)).
- `ScanNew` follows new wallet blocks and re-reads one log range of invoice overlap, at most 20 log ranges a round.
- Invoice overlap stays frequent so an earlier missed payment is found before a later payment decides ownership.
- It reads logs for at most 60% of its deadline, then records what it read; it always reads past the old cursor.
  - So a slow or narrow provider still moves the cursor every round, and a backlog is caught up over several rounds.
- It also re-reads detected transfers' block heights, so confirmation still requires fresh logs and matching headers.
  - A detected transfer below the scan's start is read at its own height and never holds the start back.
- An unchanged head without detected wallet transfers needs no wallet log queries.
- `Recover` keeps a separate durable checkpoint in `chain_recoveries`.
- Each sweep starts 2,000 blocks before its previous completed checkpoint and pins its target before reading.
- Each round recovers at most five log ranges; successful chunks commit their progress with their transfers.
- Fast scans never move the recovery checkpoint. Recovery never moves the fast cursor.
- Failed chunks retain their position; restarts resume unfinished sweeps.
- A completed sweep schedules the next sweep one minute later.
- Changed wallet or token subscriptions trigger recovery without waiting for that timer.
- Subscription changes preserve unfinished progress, rewinding only when the new wallet overlap requires it.
- Startup uses the existing full `Scan` to establish a new chain's cursor.
- Log queries cover at most 2,000 blocks each.
- A range every endpoint refuses halves, down to one block; rate limits never shrink it.
- An oversized single block uses `eth_getBlockReceipts`, filtered by the same token and topic rules.
- Ten accepted queries double a narrowed range again, up to 2,000 blocks.
- HTTP scan limits shrink queries without marking the provider unavailable.
- Batch-size limits every endpoint gives split header and balance reads; ten accepted batches double them again.

Receive addresses and wallets go into topic lists of at most 1,000: go-ethereum nodes, Arbitrum's public RPC
among them, refuse more with "exceed max topics". Invoices leave the deposit scan 30 days after their settle deadline (the
contracts' `MAX_HOLD`), unless a deposit to them is still detected: later money is moved only by the refund authority, from the chain.
Their receivers' own events are still read while they hold booked money, so those moves are recorded (R-183). A transfer already recorded
under another block and then mined again is skipped with an `ALERT` log, so the chain's scan goes on.
Invoices on a chain are created only once the worker has its cursor (`ErrNotWatched`, 503): a first scan starts at the
finalized block and would never see a payment made before it. One JSON-RPC batch then reads `finalized` and the header of every block it judges, so they usually come
from one node. One transaction then:
- marks a `detected` row `reorged` only when the chain shows another block hash at its height; a log merely missing
  from one answer (a lagging or overloaded node) proves nothing;
- inserts each deposit whose block hash matches, `confirmed` when the block is at or below `finalized` (D-45), else
  `detected`; a `reorged` row whose block is canonical again comes back;
- advances the fast cursor or the recovery checkpoint, according to the scan type.
The same scan records profile-wallet transfers (R-38): `Transfer` logs of the chain's enabled tokens with any profile
wallet as sender, then as receiver (two `eth_getLogs` per range), one row per wallet side, by the deposit rules above
(detected, confirmed at or below `finalized`, reorged only when the chain shows another block at its height, a
re-mined copy gets a new row). A token disabled while one of its
transfers is still detected stays in the scan until those rows confirm or are reorged, so their pending state can still resolve;
its new transfers are not recorded. New wallet subscriptions trigger recovery through the previous checkpoint's 2,000-block overlap.
Transfers older than that window are not looked for: those of wallets made before this table existed, or before a
chain's first scan. Arc native-coin sends to a wallet log only the system emitter's `Transfer`; this scan reads it as the deposit scan does, so each counts once as Arc USDC.
Only the invoice's own
token counts. The row stores the emitting contract (`0x3600…` for an Arc native send), so the foreign key also rejects a look-alike. Block hashes and
times come from the RPC, never computed in Go. On Arc, native USDC sends to a receive address count from the system emitter's logs (R-186, money-safety).
Scanning again changes nothing, so a restarted worker resumes from the cursor.

- Check status (R-55) queues an invoice rescan in `invoice_rechecks`.
- Historical jobs take at most five requested rescans, with a separate 30-second deadline.
- Each scan starts one minute before invoice creation, found by binary search and saved before reading logs.
- Each invocation reads at most five log ranges per invoice and saves its next block.
- Failed requested rescans wait one minute, allowing later requests through.
- Wallet recovery has its own ten-second budget.
- Rescans record observations without moving the fast cursor; a later active job verifies and books them.
- Requests outside the watch window are dropped because those funds belong to the refund authority.

## Signer

`internal/settlement` (R-22), one `Signer` per executor key (the signer's lock, [startup](#startup)). When the ledger marks an invoice `paid` it queues one
settlement intent (unique per invoice) in the same transaction. Every transaction uses the selected provider's suggested tip and current base fee (D-15), never above the chain's ceiling per gas unit (R-189). For each due intent the
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
   - A replacement that would pass `MaxFeeFactor` (2) times a new settle's fee cap, or the chain's ceiling, is not signed.
     - The saved bytes are sent again as they are.
   - When the executor's next mined nonce has nothing pending and no saved settle holds it (a settle saved but never
     sent, then settled by the refund authority), a zero-value transfer to the executor fills it, so the settles after
     it can mine.
2. Otherwise it signs new settlement bytes only when all of these hold:
   - the merchant payable covers the amount and every movement of the invoice is booked;
   - the finalized balance is at least the ledger's booked receiver balance (else an `ALERT`).
   It re-reads the terms and refuses for good (`refused` with a reason, nothing sent) unless the invoice is
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
     The owner gets one email a day (`settlement.waiting`): their paid money waits, and past the deadline only the
     refund authority can settle it. Who pays for more is the business-model question (Q-10).
4. Deploys the receiver if needed (`deploy` is idempotent).
   - When a transaction we never saved waits at the executor's next mined nonce (an earlier deploy the fee left
     behind), the deploy takes that nonce.
     - It pays twice today's fee, up to the chain's ceiling, so later transactions don't queue behind it.
   - Then waits up to 10 s for the RPC to show the receiver's code at the deploy's block or later (else the attempt
     ends and is tried again). A node that has not seen the deploy estimates settle as a call to an empty address,
     which runs out of gas.
   - Signs `settle()` with:
     - gas: the chain's own gas estimate, at the deploy's block when it deployed in this attempt (on Arbitrum that
       estimate counts the L1 data gas; a node that can't estimate at a block is asked at latest), at least
       `SettleGasFloor` (`TempoSettleGasFloor`, 580,000, on Tempo), plus a fifth;
     - nonce: the node's pending nonce, but never below the one after the deploy it just sent or after the last settle
       still `sent` on this chain (a lagging node may not count them).
       - A confirmed intent sets no floor: its own settle is final, or another settler settled first.
       - Our settle may still mine then and revert. A deploy given its nonce fails, and is signed again next round.
       - Else a settle saved but never sent, then settled by the refund authority, would leave a nonce gap for good.
   - Saves sender, nonce, hash and signed bytes, then sends. After a crash it sends the same saved bytes again (same
     nonce, so at most one settle can be mined). The contract's `AlreadySettled` is a last guard.
5. Confirms once all of these hold:
   - `settled()` is true at the finalized block (D-45);
   - for our settle, its receipt's block is final too;
   - the selected RPC reads `settled()` true at its finalized block (D-15, as for paid).

   Then it records the receipt's `Settled` and `FeesPaid` events as receiver movements and books the invoice.
   - Booking the settlement confirms the intent and sets the invoice's `settlement_status` `settled`.
   - A receiver another settler settled waits for the chain's scan to record its event.
   - A settle a reorg drops before that is reconciled like an unsent one.
A waiting intent also stores its wait kind (`retry`, `cap` for the sponsored limit, `unresolved`), cleared when a
settle is signed, so the invoice API can tell the owner why the money waits (R-54) without reading the reason text.
- Each intent has a three-minute deadline; its chain processes intents sequentially to preserve nonce ordering.
- Different chains run independently.
- New signing attempts for the same user take turns across chains until their signed settlement is saved.
- Sent intents bypass that user gate; receipt waits do not hold it.
- Receipt waits start with one second, double to four seconds, and stop after one minute.
- Advisory-lock checks are serialized on their dedicated connection.
- The signer checks that lock before each intent and again after waiting for the user's turn.
It signs only `factory.deploy(terms)` and `receiver.settle()`, besides the gas swap above, and only for chains enabled in the database: a chain
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
  after the close, `expires_at` or the reopened one) and any deposit after the invoice is final go entirely to
  `payer_held` (D-24, D-26).
- Payer chooses (D-76): an option's processing also locks its main row.
  - The choice is made once a transfer is final on its own chain; no other chain is waited for (R-119).
  - Of the final transfers, the earliest on chain (block time, then block and log) makes its option `chosen_id`.
  - A final transfer can't be reorged, so the choice never moves.
  - Deposits on any other option are booked entirely to `payer_held`, as late money is.
  - So that option is never paid or settled, and it expires like any invoice.
  - Until a choice nothing is booked, and the invoice reads `detected`.
  - Concurrent ledger jobs lock the entire option group in cancel/reopen order: children by ID, then the main row.
  - Before a choice, no row of the invoice expires until every other enabled option chain was read past the close.
    A payment made before the close may still come on one of them, and it would be chosen.
- Payment status: `open` → `detected` (a transfer seen) → `partially_paid` → `paid` when the full amount is owed and
  the selected RPC's finalized `balanceOf` covers every booked deposit (D-15). An invoice owed in full never expires; it waits for
  the finalized balance check. Otherwise it becomes `expired` or `expired_partially_paid` once the chain's finalized block time
  passes `closes_at`, no transfer is still `detected`, and the finalized token balance equals the booked amount. More on
  chain than booked (a missed log) blocks expiry and logs a warning; so does less. Such
  an invoice is read again after a growing wait (R-120), and a round books invoices with new deposits first. An expired partial
  payment is moved to `payer_held` by an `expiry` ledger transaction. `refund_status` becomes `held` while
  `payer_held` > 0. One invoice's error doesn't stop the others; each balance call has a 10 s limit.
- Reopen (R-130): the owner may reopen an `expired_partially_paid` option once, a day or more before its receiver's
  settle deadline.
  - That deadline is the earlier of `settle_deadline` and `receiver_deployed_at` + 30 days, as in the contract.
  - When an option closes partly paid, the ledger reads `factory.deployedAt` at the selected RPC's finalized block.
  - It stores 0 when the receiver isn't deployed.
  - An option without a stored value can't reopen.
  - Only a refund authority recovery deploys a receiver of an unpaid option early.
  - A deploy after the close can't end the window sooner: the settle grace is at most 7 days.
  - Not while a refund is under way: `refund_status` must be `held`.
  - `reopen` ledger transactions move `payer_held`, up to the amount, back to `recipient_payable`.
  - First the money the expiry moved, then each deposit's held part in chain order.
  - Each deposit's part names its transfer, so readers see which deposits paid the creator.
  - The status goes back to `partially_paid`, and `reopened_until` is set to a day before the receiver's deadline.
  - `refund_status` becomes `none` when nothing stays held.
  - From then on the close is `closes_at`, a generated column: `greatest(expires_at, reopened_until)`.
  - Deposits until the close count; later ones are late.
  - A short close books a second `expiry`. A trigger allows reopen rows only between the first expiry and a second.
  - The guard allows `expired_partially_paid` → `partially_paid` only in the update that sets `reopened_until`, once.
  - Migration 54 refuses to roll back once an invoice reopened: the old ledger has no row for that money.
- The selected RPC reads `balanceOf` at its finalized block and reports that block (D-15, D-45). An answer from behind the watcher's finalized block
  may miss final deposits, so it decides nothing (neither paid nor expired) until the node catches up. Finalized state reads identify the block by its RPC-supplied hash. Providers must support canonical block-hash `eth_call`.
- `paid`, `expired`, `expired_partially_paid` and `canceled` are final (`ledger.Final`), but for the one reopen above.
  Only the owner cancels, from `open` before any transfer (`invoice.Cancel`, R-79); every later deposit is held. A
  trigger rejects any other status change, any change to invoice terms, and an invoice created with any status but
  `open`.
- `GET /v1/invoices/{payToken}` lists deposits with `blocksLeft`/`secondsLeft` from the finalized block (R-28) and `blocksTotal`, the wait counted
  from the finalized block kept on the transfer row when it was first seen (`detected_finalized_block`, R-73).

```
open ──transfer seen──▶ detected ──booked < amount──▶ partially_paid ──booked ≥ amount and balanceOf agrees──▶ paid
open/detected/partially_paid ──finalized block time > the close──▶ expired / expired_partially_paid (held)
expired_partially_paid ──owner reopens once (R-130)──▶ partially_paid, held money owed up to the amount
any deposit with block_time > the close ──▶ held for the payer, owed to the creator only by a reopen
paid ──settlement confirmed──▶ settled    held funds ──verified claim + approval──▶ refunded (later)
```
