# Backend code rules

Read this before adding files or packages. The layout below is Forwend's application of the official
[Go layout guide](https://go.dev/doc/modules/layout), [package naming advice](https://go.dev/blog/package-names)
and [interface guidance](https://go.dev/wiki/CodeReviewComments#interfaces).

## Layout

```text
apps/backend/
  cmd/
    api/main.go           process startup and dependency wiring only
    worker/main.go
    signer/main.go
  api/openapi.yaml         HTTP request and response contract
  internal/
    config/               environment loading and validation
    httpapi/              routes, middleware, JSON, HTTP error mapping
      routes.go
      profiles.go
      invoices.go
      profiles_test.go
    profile/              profile domain and operations
      profile.go          domain types, constants and rules
      service.go          service dependencies and constructor
      signup.go           one substantial operation and its private helpers
      signup_test.go
    invoice/              same ownership rule for invoices
    balance/
    activity/
    ledger/
    watcher/
    settlement/
    chain/                blockchain connection and RPC behavior
    privy/                Privy integration
    database/             connection pool and embedded migrations
      migrations/
      databasetest/
      queries/            generated sqlc package when introduced
  e2e/                    flows involving the real binaries
```

This is a placement guide for new code and scoped refactors, not a claim that every path exists or an instruction
to create them all. Keep the current Go backend; do not copy frontend folders or NestJS layers into it.

- Production application logic belongs in `internal/`. `cmd/` owns startup, wiring and process lifetime;
  balance reads, RPC selection/retry and other reusable behavior belong in a named internal package.
- Group by domain (`profile`, `invoice`, `ledger`), not global `services/`, `repositories/`, `models/` or
  `controllers/` packages. A directory is a Go package boundary, not just a visual folder.
- Start a small feature in one or two files. Split a growing package into files by operation, such as
  `create.go`, `signup.go`, `reconcile.go` or `expiry.go`, while keeping the same package. Do not move unrelated
  operations into `service.go` indefinitely, or split files only to meet a line-count limit.
- Add a subpackage only when it has its own responsibility and a small usable public interface. If two proposed
  packages constantly need each other's private details, keep them together. Shared behavior needs a named owner,
  not a `common` package created to hide an import cycle.
- HTTP handlers parse and validate the request shape, apply route authorization, call a feature operation, and map
  the result to HTTP. Domain services own business decisions and transactions. Keep HTTP request/response structs
  at the HTTP boundary and domain types with their domain; do not force transport types into services.
- `httpapi/routes.go` registers routes. Keep handlers in domain-named files; split a growing handler family into
  files such as `invoices_create.go` and `invoices_get.go` before introducing new handler packages.
- Dependencies flow from `cmd` to HTTP/worker orchestration, then domain operations and integrations. Domain
  packages never import `httpapi` or `cmd`; database infrastructure never imports domains. Explicit dependencies
  between domain packages must remain acyclic. Integrations must not call back into HTTP handlers.
- The operation owns its transaction boundary. Keep handwritten SQL with its feature, in a dedicated file when
  it grows. When adopting sqlc, keep query sources grouped by feature and generated output under
  `internal/database/queries/`; do not add a repository interface or database rewrite just to move files.
- Keep migrations in `internal/database/migrations/`. Do not edit generated code; regenerate it. Adding a
  SQL-generation tool is a separate task from reorganizing existing code.
- Keep tests beside the package code (`signup_test.go`), shared test helpers in `<package>test`, fixture files
  under the owning package's `testdata/`, and cross-process flows in `e2e/`.

The `cmd`/`internal` split and file-within-package approach follow the official
[Go module layout guide](https://go.dev/doc/modules/layout). The specific domain names and HTTP boundary are
Forwend's choices. These rules apply when adding code or performing an authorized refactor; they do not authorize
unrelated file moves or changes to money behavior.

## Naming

- Package = folder name: short, lowercase, one noun (`invoice`, `ledger`).
- Never `util`, `common`, `misc`, `types`, `interfaces`, `api`, `helpers`, `models`, `base`.
- No stutter: `invoice.Service`, not `invoice.InvoiceService`.
- Constructors name their type: `invoice.NewService`, `chain.NewClient`. Bare `New` only when it returns the type
  named like the package (`queries.New` → `*queries.Queries`).
- Test helpers: `<package>test` (`databasetest`).
- Files: descriptive lowercase names, with underscores for multiple words (`wallet_balance.go`); `_test.go`
  for tests. Use the operation name within a domain package (`invoice/create.go`), not `invoice_service_impl.go`.
  Keep domain structs, constants and errors with their owner, not central `types.go` or `constants.go` collections
  spanning unrelated domains. Export only what another package needs.

## Code

- Config: only `internal/config` reads env vars, one loader per set of needs (`LoadAPI`, `LoadWorker`). No defaults:
  a missing variable stops the binary with an error naming every missing one.
- Dependencies come through constructors. No mutable global dependencies; named errors and embedded migration files are allowed.
  No `init()` side effects except driver registration.
- `context.Context` is the first parameter of anything doing I/O.
- Errors: wrap with `%w`; expected failures are sentinel errors (`invoice.ErrConflict`). Never panic on input.
- Interfaces only for an external boundary tests must replace (Privy) or two real implementations. Declare a
  small interface in the consuming package and return concrete types from constructors. Do not create global
  interface packages or a service/repository interface pair for every domain.
- Money: `*big.Int`, `NUMERIC(78,0)`, decimal strings in JSON. Never `float64`.
- Logs: `log/slog`. Never log keys, secrets, tokens or request bodies.
- New dependency only when stdlib can't do it in a few lines; say why in the PR.
- HTTP API: [api.md](api.md). Money and chain code: [money-safety.md](money-safety.md).

## Tests

- Real Postgres (`databasetest.New(t)`) and real Anvil with the real contracts. No SQL or chain mocks (D-17).
- One test per acceptance line; table tests for rules.
- `go test -race` runs in the backend check.

## Errors and shutdown

- Database functions add operation context with `%w`; services translate expected failures to named domain errors.
  HTTP handlers use `errors.Is` to map those errors to the API response. Log unexpected errors once at the boundary.
- `cmd/api` wires config, database and listener. `httpapi.Serve` owns request draining and its deadline; close the pool
  after it returns. `routes.go` registers handlers; `health.go` implements the public database health check.
