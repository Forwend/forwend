# Example merchant

`apps/example-merchant`: a sample shop on Forwend's checkout (R-170, PLAN 11.9.5). `README.md` is its quickstart.

- It uses only what a merchant gets: the `forwend` package on the server, `@forwend/react` in the page.
- An order ships from a verified webhook, after the API says paid, once. Nothing from the browser marks it paid.
- Unit tests: `pnpm --filter @forwend/example-merchant test`. Browser tests: `apps/web/e2e/example-merchant.spec.ts`.
- `apps/web`'s `pnpm e2e` builds and starts it beside Forwend's web app and the stub api (`e2e/stub-api.mjs`).
