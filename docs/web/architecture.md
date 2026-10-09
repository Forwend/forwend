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

The target source layout and naming rules are in [structure.md](structure.md): routes assemble screens,
features own product behavior, and shared UI components are grouped by purpose. Existing paths are migrated
only in scoped refactors. `ui-web/src/index.ts` remains the public package entry point.

## Visual direction

A Dawn Path for marketing, B Dusk Ledger's dark framed product sections, C Halftone Horizon's dots as a secondary
texture (D-13). The design system as built is in [DESIGN.md](DESIGN.md), the product brief in [PRODUCT.md](PRODUCT.md)
(both maintained by the impeccable skill). Mood images and their prompts: [images.md](images.md).

## Data and trust

- The landing waitlist is a mock that sends and stores nothing (D-8).
- Users sign in on `/sign-in` with our own forms (email code with the `CodeInput` boxes, Google; D-21) on the Privy
  React SDK's headless hooks; Privy's modal is not used. Passkey sign-in comes back once users can add a passkey to
  their account. Privy loads only in the
  `(app)` route group (`/sign-in`, `/app`), never on the landing page or checkout. `/app` sends signed-out visitors to
  `/sign-in` and calls `POST /v1/me` each time it loads, which makes the personal profile and its wallet once (R-34).
- The app shell: on desktop a sidebar with the profile switcher on top (a menu to switch or add a profile), the
  profile type's pages (`APP_NAV`) and the account at the bottom (theme, sign out); on phones a header with the
  switcher (a bottom sheet) and a tab bar (Overview, Balances, Receive in the center, Activity, Account). `/app` is the
  dashboard: the total balance (one token in its unit, several as a USD estimate) with Send, Receive, Transfer and
  Withdraw (only Receive works; the others say why when pressed), pending and held only when not zero, Networks (each
  chain and token), and recent activity. Receive opens a sheet with the full address (`ReceiveAddress`), QR code and
  an exact network and token warning (the address never shows without it). `/app/balances` and `/app/activity` list
  everything; in activity only a payment carries "+". Money sent straight to the wallet shows in the balance once final, not in activity. Balances
  and activity are read again every 15 s while the tab is visible; only the newest answer is used. `/app/profiles/new` creates a freelancer
  or merchant profile with one idempotency key per visit (R-35).
- The browser calls the backend same-origin at `/api/v1/…`; `next.config.ts` forwards it to `API_URL`, so the api needs
  no CORS. The rewrite is fixed at `next build`, so `API_URL` must be set when building; Turbo hashes `.env*` and
  these variables for the web build. Request and response types are written by hand from `apps/backend/api/openapi.yaml`
  and belong to their feature under the target structure (currently `src/types/app/`):
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
