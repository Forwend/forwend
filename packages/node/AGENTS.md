# node

`forwend`: a server's client for the Forwend API and its webhooks (R-154, D-103). TypeScript, ESM,
Node 20 or later, no runtime dependency. `README.md` is its npm page.
- `src/openapi.gen.ts` is generated from `apps/backend/api/openapi.yaml` by `pnpm api:generate`; never edit it.
- Each object type in `src/types.ts` is an interface that extends a generated one, under its published name.
  - It stays an interface so users can merge declarations into it.
- The exported value lists (`PAYMENT_STATUSES` and the rest) stay hand-written.
  - `test/types.test-d.ts` fails the typecheck when a list differs from the spec's enum.
- The package uses MIT (D-103). Version 0.2.1 is published on npm; later releases use CI (PLAN 11.9.4).

- Test: `pnpm --filter ./packages/node test`. Build: `pnpm --filter ./packages/node build` writes `dist/`.
- The API's routes and answers: [docs/backend/api.md](../../docs/backend/api.md) and `apps/backend/api/openapi.yaml`.
