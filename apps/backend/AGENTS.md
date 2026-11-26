# Backend

Go API, worker, signer and webhooks sender, plus the canary and support's `ops` tool. Requirements: the task's rows in
`docs/PROJECT.md`.

## Commands

- First time: `cp .env.example .env`, then `bun run --cwd apps/backend postgres:up` (Docker).
- `bun run --cwd apps/backend test` (gofmt, vet, `go test -race` on real Postgres).
- Root `bun run dev` runs Postgres, the api, the worker, the signer and the webhooks sender beside the web app. It refuses to start without
  `EXECUTOR_PRIVATE_KEY` in `.env`, waits until each process reports ready, and exits 1 when one stops or is not ready
  in time ([startup](../../docs/backend/architecture.md#startup)). Alone: `bun run --cwd apps/backend api`
  (or `worker`, `signer`, `webhooks`).
- `sh scripts/with-env.sh go test -tags privylive ./internal/privy/`: opt-in test against the Privy test app
  (creates a throwaway user and wallet, then removes them).
- `bun run --cwd apps/backend e2e`: the money-loop gate with the real binaries on Postgres and Anvil (also in
  root `bun run e2e` and CI).
- `... | bun run --silent --cwd apps/backend canary`: checks the open invoices' terms on stdin against
  `factory.predict` on two RPCs, the api and the pay page in Chromium; exit 1 on any difference
  ([canary](../../docs/backend/money-safety.md#canary)).
- `bun run --silent --cwd apps/backend ops case <pay link>`: support's tool for held money; `return` and
  `release` queue and drop a return; `deposit` records one the scan missed ([returns through support](../../docs/backend/money-safety.md#returns-through-support)).
- `bun run --cwd apps/backend loadtest -users=1000 -duration=3m`: signed-in users polling the dashboard routes
  against the api on Anvil; not in any check ([load test](../../docs/backend/architecture.md#load-test)).

A paid invoice's money waits in its receive contract, shown as "on its way", until the signer settles it into the
profile wallet. Locally that needs `EXECUTOR_PRIVATE_KEY` in `.env`: a funded executor key on the testnet (see
[money-safety.md](../../docs/backend/money-safety.md)).

## What to read

Always: [docs/backend/rules.md](../../docs/backend/rules.md): layout, naming, code, tests.

Then only the rows that match the task:

| The task touches | Read |
|---|---|
| Any API route: JSON, errors, auth, idempotency, rate limits, first run, emails and notifications, billing details, clients, invoices, PDFs, jobs, wallet transactions | [docs/backend/api.md](../../docs/backend/api.md) |
| Receive addresses, deciding "paid", checkout, the canary, accepted risks; any invoice, watcher or signer change | [docs/backend/money-safety.md](../../docs/backend/money-safety.md) |
| Processes, startup, scaling, the load test, the data model, Privy wallets and signup, RPC pools, the watcher, the signer, invoice states | [docs/backend/architecture.md](../../docs/backend/architecture.md): the sections its index names |
