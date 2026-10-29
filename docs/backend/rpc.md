# Backend RPC operations

## Configuration

- `chains` owns canonical numeric IDs, readable unique names, EVM family, activation and maximum latest-head age.
- `rpc_endpoints` owns provider identity, legacy role label, private/public tier, priority, enablement, destination reference and budget group.
- Migration 82 seeds existing public endpoints without activating chains; Base Sepolia is added disabled if missing.
- Migration 92 removes dRPC and adds public HTTPS and WSS endpoints measured on 2026-10-29.
  - They passed chain ID, finalized tag, log range, batch and block-hash `eth_call` checks.
  - Tenderly's WSS is left out: it never answers a batch.
- Private endpoints require `secret_ref` and prohibit `public_url`; public endpoints require `public_url` and prohibit `secret_ref`.
- `RPC_ENDPOINT_SECRETS` maps references to complete URLs in the backend environment.
- Example format: `RPC_ENDPOINT_SECRETS='{"BASE_PRIMARY":"https://provider.example/api/replace-with-secret"}'`.
- Store actual credentials only in `apps/backend/.env` locally or the backend deployment's secret store.
- Only `internal/config` reads environment values; `chain.Specs` resolves references into trusted backend memory.
- No endpoint or secret-management API is exposed to merchants, payers or browsers.
- A snapshot loads once at process startup; restart API, worker and signer after changing endpoint metadata or credentials.
- Chain disablement still stops worker and signer jobs through their existing database checks.
- Adding or enabling a chain requires restarting all RPC-consuming processes before serving it.

## Adding a private endpoint

- Identify the actual upstream provider, including aliases or resellers; use one stable provider identifier for shared infrastructure.
- Use `primary` for new endpoints; existing `confirmation` labels remain valid metadata.
- Both labels use the same ordered pool for reads, verification and broadcasts.
- One configured endpoint is sufficient; provider and hostname independence are not required.
- Insert metadata using an operator connection; this example contains no credential.

```sql
INSERT INTO rpc_endpoints
    (chain_id, id, provider, role, tier, priority, secret_ref, budget_group)
VALUES
    (84532, 'base-private-primary', 'operator-a', 'primary', 'private', 10,
     'BASE_PRIMARY', 'operator-a-account');
```

- Populate `BASE_PRIMARY` in `RPC_ENDPOINT_SECRETS` for API, worker and signer before restarting them.
- Missing references or invalid URLs stop startup with a safe configuration error.
- Use the same budget group for endpoints sharing an account quota, including endpoints on different chains.
- Priority sets the starting order within each tier; lower numbers come first, and endpoint ID breaks ties.
- After that, measured answers decide (see [routing](#routing-and-health)), not the configured order.
- Disable an endpoint with `enabled=false`; edit its priority to change the starting order, then restart consumers.
- Every enabled endpoint participates in failover, including endpoints previously labeled `confirmation`.
- Additional endpoints improve availability; payment processing does not wait for a second provider.

## Routing and health

- Keep go-ethereum for RPC serialization, typed clients and transactions; the HTTP transport owns routing and destination checks.
- An endpoint URL is `https://` or `wss://`; both kinds share one pool and one ranking, measured the same way (R-185).
  - Budgets, pacing, answer checks, refusals and failover are the same for both.
- [Go RPC documentation](https://pkg.go.dev/github.com/ethereum/go-ethereum/rpc) documents custom HTTP clients and typed errors.
- Each request goes to the best eligible endpoint, chosen in this order:
  - one not known to refuse the request's size;
  - a private endpoint before a public one;
  - the soonest expected answer: its pacing wait plus its measured answer time.
- The answer time is a moving average, raised by the endpoint's recent failure share.
- An endpoint without a usable answer for 10 minutes is measured again: it costs nothing until it answers.
- Priority and endpoint ID break ties, so they only order endpoints not yet measured.
- An eligible endpoint gets at most one attempt per request; no eligible endpoint returns `chain.ErrUnavailable`.
- A log range, log result or batch an endpoint refuses goes to the next endpoint unchanged.
  - The endpoint stays healthy. For one hour it is asked last for requests that size or larger.
  - The refusal reaches the caller only when no other endpoint answered; only then does the caller narrow its query.
  - Providers differ: `sepolia.base.org` takes 201 blocks, and Arc stops at 20,000 log results.
  - A batch refused for its size, however the provider words it, counts as a batch limit, not a log range.
- An answer that the block or state is missing goes to the next endpoint, which may have it.
  - Examples: a block past a lagging node's head, or state a pruned node dropped (PublicNode on Arbitrum).
  - The endpoint stays healthy, and the miss doesn't count as a fast answer.
  - A health check that gets a miss or a refusal fails, so that endpoint rests.
  - A revert keeps its category, whatever its reason text says.
  - The miss reaches the caller only when no endpoint has the data.
- The whole request has a 30-second maximum, including health checks and budget waits; shorter caller deadlines take precedence.
- Each exchange has a five-second timeout and a 64 MiB response limit.
- Each failed endpoint rests for 0.5–1 second initially, doubling toward a 2.5–5-minute maximum.
- HTTP 401, 403, 404 and malformed responses use the maximum cooldown immediately.
- HTTP 429 honors `Retry-After`, bounded at five minutes; JSON-RPC rate limits also trigger failover.
- Connection failures rest endpoints sharing the same host; rejected credentials rest only the affected endpoint.
- Caller cancellation and request deadlines release the endpoint without changing its health; the separate HTTP attempt timeout still triggers failover.
- One probe per endpoint validates recovery; healthy recovered private endpoints are preferred again automatically.
- Identity and health are rechecked on demand at least every 30 seconds of use, plus after failures.
- A wrong chain ID quarantines that endpoint until restart after operator correction.
- Probes require the configured chain ID, a recent latest header and a valid finalized header.
- `rpc_max_head_age_seconds` defaults to 120 and accepts 1–3,600 seconds; change it only after checking the chain's block behavior.
- A halted chain can resemble a stale provider; requests stop rather than decide money from stale evidence.
- Finality delay is independent of latest-head age; finality never falls back to latest or a fixed confirmation count.
- Successful probes establish availability, not honesty; finalized evidence is trusted from the selected provider.
- Local circuit state is not shared across processes; weighted budgets are shared through Postgres.
- Structured warnings name chain ID, endpoint ID, cooldown and a safe failure category.
- Operators must monitor unavailable-chain warnings and existing worker/signer errors until dedicated metrics are implemented.

## WebSocket endpoints

- A `wss://` endpoint keeps one connection, shared by all its requests.
  - Each call gets an ID unique on the connection, so answers find their requests whatever IDs callers chose.
  - An answer error without an ID goes to the only request waiting; with several waiting, the connection drops.
- A connection idle 45 seconds is replaced before the next request: PublicNode drops silent ones at 60 seconds.
- A connection the server closes is dialed again on the next request, with no failure counted.
- No answer within the attempt timeout drops the connection; the endpoint rests like any failed one.
  - A caller's own shorter deadline leaves the connection to the other requests on it.
- One dial runs at a time; requests waiting for it keep their own deadlines.
- One answer may come in several frames, as PublicNode sends batches. All its frames together stay within 64 MiB.
- Only a failed dial rests the host's other endpoints. A lost or silent connection rests only the WSS endpoint.
- A refused upgrade counts as its HTTP status: 401, 403 or 404 rest it the maximum, 429 honors `Retry-After`.
- Batches over 50 calls go to HTTPS endpoints first: PublicNode never answers larger WSS batches.
- The pool subscribes to nothing. Server notifications are ignored; money evidence comes from finalized reads only.
- The dial uses the same destination checks as HTTPS, never a proxy, sends no `Origin`, and never follows a redirect.
- `gorilla/websocket`, already built in through go-ethereum's `rpc` package, carries the connection.

## Errors and transaction safety

- Preserve RPC error codes and safe message categories while discarding arbitrary provider text and error data.
- HTTP error bodies and redirect locations never reach callers or logs.
- Execution reverts, invalid input, insufficient funds and nonce errors do not trigger infrastructure failover.
- Log-range and batch-limit errors that every endpoint gave remain recognizable so callers can reduce query size.
- Optional block-receipt support retains the watcher's existing fallback; broader per-method routing is deferred.
- Only allowlisted stateless reads and `eth_sendRawTransaction` pass through the transport.
- Retries replay the same signed bytes; the transport never signs, chooses nonces, increases fees or changes recipients.
- After an endpoint answers `eth_sendRawTransaction`, the same bytes also go to one endpoint on another host (R-187).
  - A node that takes a transaction and never passes it on can't hold a settlement back.
  - The second send runs in the background, never delaying the caller, and its answer is ignored.
  - It has the 30-second request limit, so a hung endpoint rests on its attempt timeout and the next one gets it.
- A timeout may follow successful submission; settlement reconciles its saved hash and nonce before deciding what to send next.
- Never treat a broadcast response or an “already known” message as finalized settlement.
- Finalized balance snapshots pin the RPC-supplied block hash and require canonical state through [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898).
- Do not recompute block hashes with Ethereum headers: Tempo's header format differs.
- Providers lacking canonical block-hash state reads fail closed; verify this capability before enabling them.
- Batches retry as a whole; [Geth's batch documentation](https://geth.ethereum.org/docs/interacting-with-geth/rpc/batch) does not promise atomic state snapshots.
- Watcher checkpoints, reorg detection, ledger transactions and finalized receiver movements remain governed by [money safety](money-safety.md).

## Network and secret controls

- HTTPS or WSS is required; userinfo and fragments are rejected; IP literals must name public addresses.
  - A WSS URL passes exactly the checks of its HTTPS form; `ws://` and `http://` work only for local Anvil.
- Destination addresses are checked immediately before each connection, including addresses returned after DNS changes.
- Private, loopback, link-local, metadata and reserved addresses are refused; redirects and ambient proxies are disabled.
- `RPC_ALLOW_LOOPBACK=1` permits local Anvil only; production Compose fixes it to `0`.
- [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) supports address filtering and disabling redirects.
- The same public-address rule protects webhooks; the canary shares destination filtering without sharing factory configuration.
- The canary retains independent `CANARY_RPC_URLS`, factory and code-hash configuration, as required by R-51.
- Treat configuration-write access as privileged; metadata identifiers must never contain credentials.
- Deployment operators must separate migration privileges from read-only endpoint configuration access for runtime database roles.
- Current API startup still performs migrations; separate migration execution is deferred, and this deployment limitation remains explicit.
- Environment secrets are readable by their process and privileged host operators; restrict deployment access and local file permissions.
- Rotate with a new reference/version, validate it, restart consumers, then revoke the previous credential after the rollback window.
- [OWASP secret guidance](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) recommends least privilege, rotation and excluding secrets from logs.
- No private URL is encrypted in Postgres; a managed secret service can replace environment delivery without changing endpoint metadata.

## Migration and verification

- Restart API, worker and signer together when changing the provider policy.
- Apply migration 82 through the API's normal migration process.
- Translate existing private provider configuration into explicit endpoint records and generic secret references before restarting consumers.
- `CHAINS_FILE` and `INFURA_API_KEYS` no longer configure the backend; private credentials are not copied automatically.
- The contracts package retains its separate deployment picker and manifest; those values no longer configure payment services.
- Restart all RPC consumers and inspect startup results for each enabled chain.
- Verify chain identity, canonical hash reads and historical state availability from the deployment region.
- Local tests cannot establish public-provider uptime, quotas or honesty.
- Run `pnpm --filter @forwend/backend test` for configuration, security, failover, ledger and signer regressions.
- Run `pnpm --filter @forwend/backend e2e` for real-binary invoice, payment, confirmation and settlement workflows.
- Fault proxies around Anvil cover failed providers and ambiguous broadcasts without relying on external RPC availability.
- Rollback requires the previous binary's previous environment configuration; retain old secret versions until rollback is no longer required.

## Future architecture

- Keep endpoint records and the `chain` client boundary stable; introduce versioned configuration snapshots when dynamic updates become necessary.
- Validate snapshots before activation, apply them atomically and drain old pools.
- Add a private administration interface with scoped permissions and audited endpoint changes.
- Use managed secret retrieval and workload identities when hosting is selected; keep versioned references for rotation and rollback.
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html) illustrates managed encryption, rotation and least-privilege access.
- Add metrics for endpoint latency, errors, cooldown, head age, lag and quota waits.
- Alert on exhausted pools, stalled payment cursors and long settlement delays.
- Add active health probes, archive capability routing and measured latency selection only when operational needs justify their cost.
- Evaluate [eRPC](https://docs.erpc.cloud/config/failsafe) for larger deployments requiring shared health, routing and observability.
- Preserve bounded retries and identical signed transaction bytes when changing routing infrastructure.
- Do not implement an administration service, shared health service, custom encryption or a routing proxy in this MVP.
