# Web app

Next.js app: landing page, private `/kit`, signed-in `/app`, public checkout `/pay/<token>`, the public
stop reminders page `/reminders/<token>`, the public quote page `/w/<token>`, the public payment link page
`/l/<slug>` and the public API docs `/docs`. Team invites open `/invite/<token>`.

## Commands

- `pnpm dev` from the root starts the web app (http://localhost:3000) and the backend (Postgres in Docker, api,
  worker and signer; it needs `EXECUTOR_PRIVATE_KEY` in `apps/backend/.env`).
  `/kit` works in dev; a production build needs `KIT_ENABLED=1`. Sign-in and `/app` need
  `apps/web/.env` (copy `.env.example`) and the backend api at `API_URL`.
- `pnpm --filter @forwend/web test` (Vitest), `e2e` (deterministic Playwright), `e2e:live` (explicit Privy tests), `lighthouse`.
- Live tests require free ports 3000 and the configured API port; they refuse to reuse existing servers.

## What to read

Always: [docs/web/rules.md](../../docs/web/rules.md): code and content rules.

Then only the rows that match the task:

| The task touches | Read |
|---|---|
| Anything visible: screens, components, styles, motion | [docs/web/DESIGN.md](../../docs/web/DESIGN.md): the design system; its index names the section for each screen |
| New, moved or renamed files; which shared component to use; requests, hooks, state | [docs/web/structure.md](../../docs/web/structure.md) |
| The app's parts, sign-in, navigation, API calls, caching, checkout and Receive wiring, security headers, what the app trusts, tests | [docs/web/architecture.md](../../docs/web/architecture.md): how the app and UI packages fit |
| Any words users read: landing, app, pay page | [docs/web/PRODUCT.md](../../docs/web/PRODUCT.md): product brief |

The Impeccable skill reads `PRODUCT.md` and `DESIGN.md` next to the app: both are symlinks to `docs/web/`; edit those.
