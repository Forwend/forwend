# Backend (Go)

API, worker and signer for Forwend (PLAN.md Phase 6). Requirements: R-14…R-24 in `docs/PROJECT.md`. Contract rules the
backend must keep: `packages/contracts/AGENTS.md` ("Backend rules").

Sources for these rules: the official module layout (https://go.dev/doc/modules/layout) and package naming
(https://go.dev/blog/package-names). `golang-standards/project-layout` is not an official standard; we take only its
names for non-Go folders.

## Commands

- First time: `cp .env.example .env`, then `pnpm --filter @forwend/backend postgres:up` (Docker).
- `pnpm --filter @forwend/backend test`: gofmt, go vet, go test against real Postgres.
- `pnpm --filter @forwend/backend api` (or `worker`, `signer`): runs a binary with `.env` loaded.

## Layout

```text
apps/backend/
  cmd/<binary>/main.go     api, worker, signer: wiring only (config, open dependencies, start, stop on signal)
  internal/                all Go code; other modules cannot import it (no pkg/)
    config/                every environment variable, read and checked in one place
    database/              pool, embedded migrations (migrations/NNNNN_name.sql), databasetest
      queries/             sqlc: one <feature>.sql per feature, generated Go in one package `queries`
    httpapi/               router, middleware, request/response JSON, error → status mapping; one file per feature
    <feature>/             one business area: invoice, ledger, watcher, settlement, address, chain, auth, privy, …
  scripts/                 shell helpers (with-env.sh)
  .env.example             every variable the binaries read, with local values
```

Inside a feature package (`internal/invoice/`):

| File | Holds |
|---|---|
| `invoice.go` | the domain types and their rules (`Terms`, `Status`, validation) |
| `service.go` | use cases: `Service` with methods such as `Create`, `Get`; transactions live here |
| `*_test.go` | next to the file it tests, same name (`service.go` → `service_test.go`) |

SQL for the feature lives in `internal/database/queries/invoice.sql`; sqlc generates one shared package (its own
`queries.New`, `Queries` and table structs), so features never redeclare it. Never edit generated files; regenerate.

Flow: `httpapi` (HTTP only: parse, call the service, write JSON) → `<feature>.Service` (rules, transactions) →
`queries` and chain clients. A feature never imports `httpapi` or a `cmd`. Features may import lower ones (`invoice` uses
`address`, `chain`), never in a cycle; if two features need each other, the shared part becomes its own package.

## Naming (go.dev/blog/package-names, plus our additions)

- Package names: short, lowercase, one word, a noun for what it provides: `invoice`, `ledger`, `address`. No
  underscores or mixedCaps; folder name = package name.
- Never `util`, `common`, `misc`, `types`, `interfaces`, `api` (the blog), nor `helpers`, `models`, `base` (ours).
  Split by purpose instead.
- No stutter: `invoice.Service`, `address.Compute`, not `invoice.InvoiceService`.
- Constructors name their type: `invoice.NewService`, `chain.NewClient`, `chain.NewWatcher`. A bare `New` only when it
  returns the type named like the package (`queries.New` → `*queries.Queries`).
- Test helpers for a package live in `<package>test` (`databasetest`).
- Files: lowercase, underscores only for `_test.go`; one job per file.

## Code rules

- Configuration comes only from environment variables through `internal/config`, one loader per set of
  needs (`LoadAPI`, `LoadWorker`; the signer gets `LoadSigner` when it needs its key); nothing else calls
  `os.Getenv`. `.env` locally, real variables in CI and production. No
  defaults: a missing variable stops the binary with an error that names every missing one.
- Dependencies are passed in through constructors (`invoice.NewService(pool, addresses)`); no package-level state, no `init()`
  side effects except driver registration.
- `context.Context` is the first parameter of anything that does I/O.
- Errors: wrap with `fmt.Errorf("create invoice: %w", err)`; expected failures are exported sentinel errors in the
  feature (`invoice.ErrIdempotencyConflict`); `httpapi` maps them to status codes in one place. Never panic for input.
- Interfaces are declared by the package that uses them, and only for an external boundary that tests must replace
  (Privy) or two real implementations. No interface for our own SQL: tests use real Postgres.
- Money: `*big.Int` in Go, `NUMERIC(78,0)` in Postgres, decimal strings in JSON. Never `float64`. Tokens are chain ID +
  contract address. Addresses are text with a `chain_family`.
- Logs: `log/slog`. Never log a private key, secret, access token, or full request body.
- HTTP: stdlib `net/http` routing; routes and types generated from `api/openapi.yaml` at the repo root (oapi-codegen)
  once the first API route exists. The server sets `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout` and
  `IdleTimeout`; request bodies go through `http.MaxBytesReader`.
- New dependency: only when stdlib or an existing one cannot do it in a few lines; say why in the pull request.

## Tests

- Real Postgres (`databasetest.New(t)` gives each test an empty database) and real Anvil with the real contracts. No
  SQL or chain mocks (D-17).
- Table-driven tests for rules; one test per acceptance line of the task.
- The backend check runs `go test -race ./...`; a data race fails the task.
