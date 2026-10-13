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
- Every page sends Privy's recommended CSP, `frame-ancestors 'none'` and `X-Frame-Options: DENY` (no page, checkout
  included, can be framed), `nosniff`, a referrer and a permissions policy, and HSTS (`next.config.ts`). Scripts allow
  `'unsafe-inline'` because Next inlines its own; nonces would make every page dynamic.
- Users sign in on `/sign-in` with our own forms (email code with the `CodeInput` boxes, Google, passkey; D-21) on the Privy
  React SDK's headless hooks; Privy's modal is not used. Users add a passkey from the
  overview checklist (Privy's `useLinkWithPasskey`) and sign in with it (`useLoginWithPasskey`). Privy loads only in the
  `(app)` route group (`/sign-in`, `/app`), never on the landing page or checkout. `/app` sends signed-out visitors to
  `/sign-in` and calls `POST /v1/me` each time it loads, which makes the personal profile and its wallet once (R-34).
- The app shell: on desktop a sidebar with the profile switcher on top (a menu to switch or add a profile), the
  profile type's pages (`APP_NAV`) and the account at the bottom (theme, sign out); on phones a header with the
  switcher (a bottom sheet) and a tab bar (Overview, Balances, Receive in the center, Activity, Account). Switching
  profile keeps the page and shows the new profile's data, except an invoice's page, which opens the new profile's
  list (the invoice is the old profile's). `/app` is the
  dashboard: the total balance (one token in its unit, several as a USD estimate) with Send, Receive, Transfer and
  Withdraw (only Receive works; the others say why when pressed), pending and held only when not zero, Networks (each
  chain and token), and recent activity. Receive opens a sheet where the user picks the token, then the network
  (`features/receive/receive-choice.ts`, keyed by chain family so non-EVM families fit later); the choice folds into
  one row with Change, over the full address (`ReceiveAddress`), QR code and an exact network and token warning (the
  address never shows without it). `/app/balances` and `/app/activity` list
  everything; in activity only a payment carries "+". Money sent straight to the wallet shows in the balance once final, not in activity. Balances
  and activity are read again every 15 s while the tab is visible and when it comes back. `/app/profiles/new` creates a freelancer
  or merchant profile with one idempotency key per visit (R-35). While `onboardedAt` is empty, `/app` shows the first-run choice screen instead (R-50, D-73);
  `/app/billing-details` edits the profile's billing details (R-43).
- Invoices (freelancer and merchant profiles, R-44): `/app/invoices` lists them newest first with "Show more" cursor
  pages; `/app/invoices/new` (Request money for a personal profile, R-58, R-71) groups the form into Amount, Details, Dates and Client.
  The client chooses by default (`amountUsd`, at most the fewest decimals among the enabled tokens); One token asks for
  a network and token from the profile's enabled tokens (the balances list). The due date uses the kit DatePicker;
  Checkout closes after offers 1 hour to 30 days or Custom (a date and a time, sent as seconds from now, checked
  against 15 minutes to 365 days); an optional https return link goes to `returnUrl`. It turns the typed amount into
  exact base units without float, shows each error beside its field, and sends one idempotency key per filled-in form;
  `/app/invoices/<id>` shows the status timeline, due date apart from checkout expiry, client, issuer and the
  `/pay/<id>` link with a copy button. The public `GET /v1/invoices/{id}` has no client, so the detail reads it from
  `GET /v1/profiles/{id}/invoices/{invoiceId}`, whose 404 also tells that the active profile did not make the invoice.
- Invoices, Activity and Transactions (also the business overview's payments) send their filter and search to the API
  (`?status=` or `?direction=`, `?q=`) and show only its answer for the current pair, so a match on an older page shows
  at once and "Show more" continues the filtered list. `shared/hooks/use-list-filters.ts` keeps both in the page URL
  (`history.replaceState`, so reload and Back keep them); the search reaches the URL and the request 300 ms after the
  last key. ⌘K and notifications open a transaction as `/app/transactions?q=<hash>`.
- API data lives in an RTK Query cache (D-47): one store per tab (`store/store.ts`, mounted by
  `providers/store-provider.tsx` inside Privy), one `apiSlice` that adds the Privy access token, and endpoints
  injected by each feature (`features/*/…-api.ts`). On a 429 the slice waits `Retry-After` and sends the request once
  more; if that is refused too, reads pause 15 s, doubling with each refusal up to 5 min, until an answer is not a
  429 (`shared/api/rate-limit.ts`, [api rate limits](../backend/api.md#rate-limits)). Query arguments carry the profile, so a profile never shows
  another's data; a created profile joins the cached list without a refetch. A store belongs to one signed-in
  user: when the user changes or the session ends, the next render gets a fresh, empty store. Amounts stay
  strings in the cache and become `bigint` only for display.
- The browser calls the backend same-origin at `/api/v1/…`; `next.config.ts` forwards it to `API_URL`, so the api needs
  no CORS. The rewrite is fixed at `next build`, so `API_URL` must be set when building; Turbo hashes `.env*` and
  these variables for the web build. Request and response types are written by hand from `apps/backend/api/openapi.yaml`
  and belong to their feature (`features/profiles/profile.ts`, `features/balances/balances.ts`,
  `features/activity/activity.ts`): `openapi-typescript` needs the TypeScript compiler API, which TypeScript 7 does not have.
- Features depend on each other in three places: the receive sheet (`features/receive`) takes the `Balances` type from
  `features/balances` to show which networks and tokens the address takes, `features/invoices` takes the API
  status values and `activityStatus` from `features/activity`, so an invoice shows the same status everywhere, and
  the `TokenBalance` type from `features/balances` for the tokens an invoice can use; `features/pay` takes the
  `Invoice` type, the `getInvoice` query and the progress helpers from `features/invoices` and the API status values
  from `features/activity`.
- Checkout `/pay/<id>` (R-45) sits outside the `(app)` group: no Privy, no sign-in, `noindex`. A malformed id is a 404;
  an id the API does not know shows the 404 page. It reads the public `GET /v1/invoices/{id}` every 15 s through a
  store whose requests carry no token (`providers/public-store-provider.tsx`). The browser recomputes the receive
  address from the terms with the factory and implementation built into the page (`features/pay/receive-address.ts`,
  keccak256 from `@noble/hashes`, tested against the R-15 vectors) and shows no address on a mismatch. Token symbol and
  decimals come from `PAY_TOKENS` in the build, never the API; another token is refused, so enabling a token in the
  API also needs an entry there. The address and QR show only after the payer picks the network and presses Show
  address, with one line naming the exact token and network. A payer-chooses invoice (R-57) lists its `options`: until
  one has money the payer picks the network, then a token on it, with selects (`features/pay/option-picker.tsx`), and
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
`test-results/`; the spec files, one per behavior, reuse it and run in one worker in name order. What is
worth a test: [rules.md](rules.md).
