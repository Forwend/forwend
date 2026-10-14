# Web app

Next.js app: landing page, private `/kit`, signed-in `/app` and public checkout `/pay/<id>`.

## Commands

- `pnpm dev` from the root starts the web app (http://localhost:3000) and the backend (Postgres in Docker, api,
  worker and signer; it needs `EXECUTOR_PRIVATE_KEY` in `apps/backend/.env`).
  `/kit` works in dev; a production build needs `KIT_ENABLED=1`. Sign-in and `/app` need
  `apps/web/.env` (copy `.env.example`) and the backend api at `API_URL`.
- `pnpm --filter @forwend/web test` (Vitest), `e2e` (Playwright), `lighthouse`.

## Read before writing code

- [docs/web/rules.md](../../docs/web/rules.md): code and content rules.
- [docs/web/DESIGN.md](../../docs/web/DESIGN.md): design system. [docs/web/PRODUCT.md](../../docs/web/PRODUCT.md): product brief.
- [docs/web/architecture.md](../../docs/web/architecture.md): how the app and UI packages fit.
- The Impeccable skill reads `PRODUCT.md` and `DESIGN.md` next to the app: both are symlinks to `docs/web/`; edit those.
