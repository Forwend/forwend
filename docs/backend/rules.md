# Backend code rules

Based on https://go.dev/doc/modules/layout and https://go.dev/blog/package-names.

## Layout

```text
apps/backend/
  cmd/<binary>/main.go   api, worker, signer: wiring only
  .env.example           every variable the binaries read
  internal/
    config/              reads every environment variable
    database/            pool, embedded migrations/NNNNN_name.sql, databasetest/
      queries/           sqlc: one <feature>.sql per feature, one generated package
    httpapi/             HTTP only: routes, middleware, JSON, error mapping
    <feature>/           invoice, ledger, watcher, settlement, address, chain, auth, privy, …
```

A feature package holds `<feature>.go` (types and their rules), `service.go` (use cases, transactions) and tests.

- All Go code is in `internal/`; no `pkg/`.
- Flow: `httpapi` → `<feature>.Service` → `queries` and chain clients.
- A feature never imports `httpapi` or `cmd`. No import cycles: shared code becomes its own package.
- Never edit generated code; regenerate it.

## Naming

- Package = folder name: short, lowercase, one noun (`invoice`, `ledger`).
- Never `util`, `common`, `misc`, `types`, `interfaces`, `api`, `helpers`, `models`, `base`.
- No stutter: `invoice.Service`, not `invoice.InvoiceService`.
- Constructors name their type: `invoice.NewService`, `chain.NewClient`. Bare `New` only when it returns the type
  named like the package (`queries.New` → `*queries.Queries`).
- Test helpers: `<package>test` (`databasetest`).
- Files: lowercase, underscores only in `_test.go`. One job per file; `service.go` is tested in `service_test.go`.

## Code

- Config: only `internal/config` reads env vars, one loader per set of needs (`LoadAPI`, `LoadWorker`). No defaults:
  a missing variable stops the binary with an error naming every missing one.
- Dependencies come through constructors. No package-level state, no `init()` side effects except driver registration.
- `context.Context` is the first parameter of anything doing I/O.
- Errors: wrap with `%w`; expected failures are sentinel errors (`invoice.ErrConflict`). Never panic on input.
- Interfaces only for an external boundary tests must replace (Privy) or two real implementations, declared where used.
- Money: `*big.Int`, `NUMERIC(78,0)`, decimal strings in JSON. Never `float64`.
- Logs: `log/slog`. Never log keys, secrets, tokens or request bodies.
- New dependency only when stdlib can't do it in a few lines; say why in the PR.
- HTTP API: [api.md](api.md). Money and chain code: [money-safety.md](money-safety.md).

## Tests

- Real Postgres (`databasetest.New(t)`) and real Anvil with the real contracts. No SQL or chain mocks (D-17).
- One test per acceptance line; table tests for rules.
- `go test -race` runs in the backend check.
