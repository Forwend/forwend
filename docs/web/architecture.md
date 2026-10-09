# Web architecture

One Next.js app (App Router, TypeScript strict) for every surface: landing `/`, private `/kit`, and later the
dashboard and hosted checkout `/pay/<invoice>` (PROJECT D-2). Rules: [rules.md](rules.md).
Whole system: [architecture.md](../architecture.md).

## Parts

| Part | Role |
|---|---|
| `packages/design-tokens` | Every color, type size, space, radius, shadow, blur and duration as CSS variables, light and dark (D-4). Tailwind v4 reads them; a unit test checks contrast (R-2). |
| `packages/ui-web` | Shared React components built only on the tokens: buttons, fields, address, payment status and money display, motion, theme switch. Money is `bigint` base units plus decimals (D-6). |
| `apps/web` | Pages and page-specific sections (landing, kit). Imports tokens and components; adds no raw colors or sizes. |
| `/kit` | Shows every token and component with all states; private (`KIT_ENABLED=1`, `noindex`, not in the sitemap) (D-5, R-4). |

In `ui-web/src`, `components/<component-name>.tsx` owns each component, `hooks/` holds shared React hooks,
and `index.ts` is the public import surface. Shared field classes live in `constants/field.ts`.

## Visual direction

A Dawn Path for marketing, B Dusk Ledger's dark framed product sections, C Halftone Horizon's dots as a secondary
texture (D-13). The design system as built is in [DESIGN.md](DESIGN.md), the product brief in [PRODUCT.md](PRODUCT.md)
(both maintained by the impeccable skill). Mood images and their prompts: [images.md](images.md).

## Data and trust

- The landing waitlist is a mock that sends and stores nothing (D-8).
- Users sign in with the Privy React SDK (email code, Google, passkey; D-21) on `/sign-in`. Privy loads only in the
  `(app)` route group (`/sign-in`, `/app`), never on the landing page or checkout. `/app` sends signed-out visitors to
  `/sign-in` and calls `POST /v1/me` each time it loads, which makes the personal profile and its wallet once (R-34).
- The browser calls the backend same-origin at `/api/v1/…`; `next.config.ts` forwards it to `API_URL`, so the api needs
  no CORS. The rewrite is fixed at `next build`, so `API_URL` must be set when building; Turbo hashes `.env*` and
  these variables for the web build. Request and response types are written by hand in `src/types/app/` from `apps/backend/api/openapi.yaml`:
  `openapi-typescript` needs the TypeScript compiler API, which TypeScript 7 does not have.
- The checkout page recomputes the receive address from the invoice terms and refuses to show a mismatch; it loads no
  third-party scripts ([money-safety.md](../backend/money-safety.md)).

## Tests

Vitest for logic, Playwright for flows, axe for accessibility, Lighthouse for performance (D-10, R-10, R-11).
`pnpm e2e` also runs the live sign-in (`e2e/privy`, `playwright.privy.config.ts`) when `apps/web/.env` holds the Privy
test account: the real Privy app and backend api, on `http://localhost:3000` (the only origin Privy allows) and
`API_URL`; running servers there are reused, so a server already on port 3000 or the api port must be this checkout's
(`pnpm dev`, `pnpm --filter @forwend/backend api`). CI has no test account and skips it. What is
worth a test: [rules.md](rules.md).
