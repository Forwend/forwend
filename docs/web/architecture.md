# Web architecture

One Next.js app (App Router, TypeScript strict) for every surface: landing `/`, private `/kit`, the signed-in
app `/app`, the public checkout `/pay/<invoice>` and the public stop reminders page `/reminders/<token>` (PROJECT D-2,
R-96). Rules: [rules.md](rules.md).
Whole system: [architecture.md](../architecture.md).

## Parts

| Part | Role |
|---|---|
| `packages/design-tokens` | Every color, type size, space, radius, shadow, blur and duration as CSS variables, light and dark (D-4). Tailwind v4 reads them; a unit test checks contrast (R-2). |
| `packages/ui-web` | Shared React components built only on the tokens: buttons, fields, address, payment status and money display, motion, theme switch. Money is `bigint` base units plus decimals (D-6). |
| `apps/web` | Routes, screens and features: landing, kit, `/app`, `/pay`, `/reminders`. Imports tokens and components; adds no raw colors or sizes. |
| `/kit` | Shows every token and component with all states; private (`KIT_ENABLED=1`, `noindex`, not in the sitemap) (D-5, R-4). |

The source layout and naming rules are in [structure.md](structure.md): routes assemble screens,
features own product behavior, and shared UI components are grouped by purpose. `ui-web/src/index.ts` remains the public package entry point.

## Visual direction

A Dawn Path for marketing, B Dusk Ledger's dark framed product sections, C Halftone Horizon's dots as a secondary
texture (D-13). The design system as built is in [DESIGN.md](DESIGN.md), the product brief in [PRODUCT.md](PRODUCT.md)
(edit them with the change they describe). Mood images and their prompts: [images.md](images.md).

## Data and trust

- The landing waitlist is a mock that sends and stores nothing (D-8).
- Every page sends Privy's recommended CSP, `frame-ancestors 'none'` and `X-Frame-Options: DENY` (no page, checkout
  included, can be framed), `nosniff`, a referrer and a permissions policy, and HSTS (`next.config.ts`). Scripts allow
  `'unsafe-inline'` because Next inlines its own; nonces would make every page dynamic.
- Users sign in on `/sign-in` with our own forms (email code with the `CodeInput` boxes, Google, passkey; D-21) on the Privy
  React SDK's headless hooks; Privy's modal is not used. Users add a passkey from the
  overview checklist (Privy's `useLinkWithPasskey`) and sign in with it (`useLoginWithPasskey`). Privy loads only in the
  `(app)` route group (`/sign-in`, `/app`), never on the landing page or checkout. `/app` sends signed-out visitors to
  `/sign-in` and calls `POST /v1/me` each time it loads, which makes the personal profile and its wallet once (R-34).
- Pages, the app shell and the dashboard look as [DESIGN.md](DESIGN.md) says. Wiring behind them:
  - Navigation comes from one `APP_NAV`; switching profile opens the new profile's `/app` (R-76).
  - Receive's choice is keyed by chain family (`features/receive/lib/receive-choice.ts`), so non-EVM families fit
    later; the address never shows without its exact network and token warning.
  - Balances and activity are read again every 15 s while the tab is visible and when it comes back. Money sent
    straight to the wallet shows in the balance once final, not in activity.
  - `/app/profiles/new` sends one idempotency key per visit (R-35) and the invoice form one per filled-in form (R-44).
    While `onboardedAt` is empty, every `/app` page sends to `/app/onboarding?next=<page>`, the first-run choice screen
    (R-50, D-73); once done that address returns to `next` (an `/app` path only, `afterOnboarding`), else `/app`.
  - The invoice form turns the typed amount into exact base units without float; a custom checkout close is sent as
    seconds from now (15 minutes to 365 days).
  - `/app/invoices/<id>` reads `GET /v1/profiles/{id}/invoices/{invoiceId}`, because the public read has no client;
    its 404 also means another profile made the invoice.
- Invoices, Activity and Transactions (also the business overview's payments) send their filter and search to the API
  (`?status=` or `?direction=`, `?q=`) and show only its answer for the current pair, so a match on an older page shows
  at once and "Show more" continues the filtered list. `shared/hooks/use-list-filters.ts` keeps both in the page URL
  (`history.replaceState`, so reload and Back keep them); the search reaches the URL and the request 300 ms after the
  last key. ⌘K and notifications open a transaction as `/app/transactions?q=<hash>`.
- API data lives in an RTK Query cache (D-47): one store per tab (`store/store.ts`, mounted by
  `providers/store-provider.tsx` inside Privy), one `apiSlice` that adds the Privy access token, and endpoints
  injected by each feature (`features/*/api/*-api.ts`). On a 429 the slice waits `Retry-After` and sends the request once
  more; if that is refused too, reads pause 15 s, doubling with each refusal up to 5 min, until an answer is not a
  429 (`shared/api/rate-limit.ts`, [api rate limits](../backend/api.md#rate-limits)). Query arguments carry the profile, so a profile never shows
  another's data; a created profile joins the cached list without a refetch. A store belongs to one signed-in
  user: when the user changes or the session ends, the next render gets a fresh, empty store. Amounts stay
  strings in the cache and become `bigint` only for display.
- The browser calls the backend same-origin at `/api/v1/…`; `next.config.ts` forwards it to `API_URL`, so the api needs
  no CORS. The rewrite is fixed at `next build`, so `API_URL` must be set when building; Turbo hashes `.env*` and
  these variables for the web build. Requests and responses are Zod schemas written from `apps/backend/api/openapi.yaml`
  in their feature's `schemas/` (`features/invoices/schemas/invoices.ts`), on shared blocks in `shared/schemas/api.ts`
  (base units, addresses, hashes, times); the types in `types/` are inferred from them (F170). Every RTK Query endpoint
  checks its response (`responseSchema`) and its request body (`argSchema`): a response that breaks its schema is a
  failed request, shown like any other failure, and logged by endpoint and field, never by value; a body that breaks
  its schema is never sent. `openapi-typescript` is not used: it needs the TypeScript compiler API, which TypeScript 7
  does not have.
- Features import each other only here: receive → balances; invoices → activity, balances, clients (the client block
  an invoice copies, R-86); clients → profiles (the country list); pay → activity, invoices
  (including the `check-status` and `invoice-progress` components); onboarding → activity, invoices, profiles,
  transactions; transactions → invoices (the bell's invoice events, R-81). No cycles ([structure.md](structure.md)); money helpers and words that several features show live in
  `shared/lib/money.ts` and `shared/constants/money-copy.ts`. Add no new edge without listing it here.
- Checkout `/pay/<id>` (R-45) sits outside the `(app)` group: no Privy, no sign-in, `noindex`. A malformed id is a 404;
  an id the API does not know shows the 404 page. It reads the public `GET /v1/invoices/{id}` every 15 s through a
  store whose requests carry no token (`providers/public-store-provider.tsx`). The browser recomputes the receive
  address from the terms with the factory and implementation built into the page (`features/pay/lib/receive-address.ts`,
  keccak256 from `@noble/hashes`, tested against the R-15 vectors) and shows no address on a mismatch. Token symbol and
  decimals come from `PAY_TOKENS` in the build, never the API; another token is refused, so enabling a token in the
  API also needs an entry there. The address and QR show only after the payer picks the network and presses Show
  address, with one line naming the exact token and network. A payer-chooses invoice (R-57) lists its `options`: until
  one has money the payer picks the network, then a token on it, with selects (`features/pay/components/option-picker.tsx`), and
  the page checks that option's terms with its own id, which must derive from the link's; the pick goes into
  `?option=<id>` and the shown address into session storage, so a reload keeps both (R-68). Paid and settled come only from the API (D-29). It loads no
  third-party scripts ([money-safety.md](../backend/money-safety.md)).

## Tests

Vitest for logic, Playwright for flows, axe for accessibility, Lighthouse for performance (D-10, R-10, R-11).
`pnpm e2e` also runs the live sign-in (`e2e/privy`, `playwright.privy.config.ts`) when `apps/web/.env` holds the Privy
test account: the real Privy app and backend api, on `http://localhost:3000` (the only origin Privy allows) and
`API_URL`; running servers there are reused, so a server already on port 3000 or the api port must be this checkout's
(`pnpm dev`, `pnpm --filter @forwend/backend api`). CI has no test account and skips it. Privy throttles repeated
sign-ins, so a setup project (`e2e/privy/session.setup.ts`) signs in once and saves the session in the ignored
`test-results/`; the spec files, one per behavior, reuse it and run in one worker in name order.
Every run shares that account and the dev database, so its data must not pile up toward a profile cap (D-85).
Its invoices and requests close within 2 days, and Send to client is mocked. What is worth a test: [rules.md](rules.md).
