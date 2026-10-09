# Backend

Go API, worker and signer (PLAN Phase 6). Requirements R-14…R-24 in `docs/PROJECT.md`.

## Commands

- First time: `cp .env.example .env`, then `pnpm --filter @forwend/backend postgres:up` (Docker).
- `pnpm --filter @forwend/backend test` (gofmt, vet, `go test -race` on real Postgres).
- `pnpm --filter @forwend/backend api` (or `worker`, `signer`).
- `pnpm --filter @forwend/backend e2e`: the money-loop gate with the real binaries on Postgres and Anvil (also in
  root `pnpm e2e` and CI).

## Read before writing code

- [docs/backend/rules.md](../../docs/backend/rules.md): layout, naming, code, tests.
- [docs/backend/api.md](../../docs/backend/api.md): routes, JSON, errors, auth, idempotency.
- [docs/backend/money-safety.md](../../docs/backend/money-safety.md): invoices, watcher, signer, checkout.
- [docs/backend/architecture.md](../../docs/backend/architecture.md): processes, data model, state machine.
