# node

`forwend`: a server's client for the Forwend API and its webhooks (R-154, D-103). Hand-written TypeScript, ESM,
Node 20 or later, no runtime dependency. `README.md` is its npm page.
- The package uses MIT (D-103). Version 0.2.0 is published on npm; later releases use CI (PLAN 11.9.4).

- Test: `pnpm --filter ./packages/node test`. Build: `pnpm --filter ./packages/node build` writes `dist/`.
- The API's routes and answers: [docs/backend/api.md](../../docs/backend/api.md) and `apps/backend/api/openapi.yaml`.
