# Web architecture

One Next.js app (App Router, TypeScript strict) for every surface: landing `/`, private `/kit`, the signed-in
app `/app`, the public checkout `/pay/<token>` and its embed `/embed/<token>`, the public stop reminders page `/reminders/<token>`, the public
quote page `/w/<token>` and the public API docs `/docs` (PROJECT D-2, R-96, R-102, R-155). Rules: [rules.md](rules.md).
Whole system: [architecture.md](../architecture.md).

## Parts

| Part | Role |
|---|---|
| `packages/design-tokens` | Every color, type size, space, radius, shadow, blur and duration as CSS variables, light and dark (D-4). Tailwind v4 reads them; a unit test checks contrast (R-2). |
| `packages/ui-web` | Shared React components built only on the tokens: buttons, fields, address, payment status and money display, motion, theme switch. Money is `bigint` base units plus decimals (D-6). |
| `apps/web` | Routes, screens and features: landing, kit, `/app`, `/pay`, `/reminders`, `/w`. Imports tokens and components; adds no raw colors or sizes. |
| `/kit` | Shows every token and component with all states; private (`KIT_ENABLED=1`, `noindex`, not in the sitemap) (D-5, R-4). |

The source layout and naming rules are in [structure.md](structure.md): routes assemble screens,
features own product behavior, and shared UI components are grouped by purpose. `ui-web/src/index.ts` remains the public package entry point.

## Visual direction

- The current design system is in [DESIGN.md](DESIGN.md); the product brief is in [PRODUCT.md](PRODUCT.md).
- Mood images and their prompts are in [images.md](images.md).

## Data and trust

- The landing sends visitors to `/sign-in` and collects no email addresses (R-8).
- Every page sends Privy's recommended CSP, `frame-ancestors 'none'` and `X-Frame-Options: DENY` (no page, checkout
  included, can be framed), `nosniff`, a referrer and a permissions policy, and HSTS (`next.config.ts`). Scripts allow
  `'unsafe-inline'` because Next inlines its own; nonces would make every page dynamic.
  - `/embed/<token>` is the one exception (R-168, D-117): `src/proxy.ts` replaces its CSP.
  - Its `frame-ancestors` names the query's `origin` only when `GET /v1/invoices/{payToken}/embed` allows it.
  - Otherwise, a failed check included, it stays `'none'`.
  - `X-Frame-Options: DENY` stays too; browsers skip it when a CSP names `frame-ancestors` (HTML standard).
  - Header rules match paths in any case and the proxy does not, so every path keeps the denying headers.
  - The proxy reads `API_URL` at run time, so the runtime image sets it as well as the build.
- Users sign in on `/sign-in` with our own forms (email code with the `CodeInput` boxes, Google, passkey; D-21) on the Privy
  React SDK's headless hooks; Privy's modal is not used. With no wallet login, Privy's wallet list is empty and its
  WalletConnect is off, so no page fetches WalletConnect's registry or loads its code. Users add a passkey from the
  overview checklist (Privy's `useLinkWithPasskey`) and sign in with it (`useLoginWithPasskey`). Privy loads only in the
  `(app)` route group (`/sign-in`, `/app`), never on the landing page or checkout. `/app` sends signed-out visitors to
  `/sign-in` and calls `POST /v1/me` each time it loads, which makes the personal profile and its wallet once (R-34).
- A fresh sign-in (R-137): when the API answers 401 `reauth_required`, `shared/api/fresh-sign-in.ts` holds the request.
  - `providers/store-provider.tsx` mounts `FreshSignInProvider` (`features/auth/components/fresh-sign-in.tsx`) once.
  - A form sends its request through `useFreshSignIn().run`, which claims the ask: its `step` shows in the form.
  - A request no form claimed asks in the provider's own dialog.
  - The step signs in again with the email code (`useLoginWithEmail`), which Privy counts as a sign-in, not a refresh.
  - The request then goes once more with the new token; requests that need it together share one ask.
  - Public pages give no `freshSignIn`, so their 401s pass through.
  - Signing in again replaces the browser's Privy session; its other tabs share the new one (measured 2026-10-25).
- Pages, the app shell and the dashboard look as [DESIGN.md](DESIGN.md) says. Wiring behind them:
  - Navigation comes from one `APP_NAV`; switching profile opens the new profile's `/app` (R-76).
  - Each page names the permission it needs; `GET /v1/me` lists each profile's permissions (D-93).
  - `screens/app-shell/lib/app-nav.ts` hides the pages a role can't use; the shell, ⌘K and the bell skip its polls.
  - The invoice pages take token symbols and decimals from `GET /tokens`, which every role reads, not the balances.
  - A role change or removal on the Team page reads `/v1/me` again, so an Admin who changed themselves sees what is left.
  - A hidden page's address opens the role's first page instead. The API refuses those requests anyway.
  - `/invite/<token>` (R-139) sits in the `(app)` group for Privy, outside `/app`: the invited user may have no account.
  - It calls `POST /v1/me` first, so accepting finds the account, then opens the team's profile in `/app`.
  - Receive's choice is keyed by chain family (`features/receive/lib/receive-choice.ts`), so non-EVM families fit
    later; the address never shows without its exact network and token warning.
  - Balances and activity are read again every 15 s while the tab is visible and when it comes back. Money sent
    straight to the wallet shows in the balance once final, not in activity.
  - Display prices (`features/prices`, R-178, D-115) are one cache entry for the whole app.
    - Pass `PRICES_QUERY`: they are read every 5 minutes while visible and on focus, and kept an hour unused.
    - A value is bigint math on base units at the latest known price, cut to cents. Without any price there is no
      value, never 1 USD.
    - Pages name no price provider while the provider is temporary (D-115).
  - `/app/profiles/new` sends one idempotency key per visit (R-35) and the invoice form one per filled-in form (R-44).
    While `onboardedAt` is empty, every `/app` page sends to `/app/onboarding`, keeping the page asked for in the tab's
    session storage (R-50, D-73). The run's tokens step makes the named profiles (`POST /v1/me/onboarding`), then saves
    billing details, tokens and the website. The shell keeps the run open until its last step is left, then returns to
    the kept page (an `/app` path only, `afterOnboarding`), else `/app`.
  - The invoice form turns the typed amount into exact base units without float; a custom checkout close is sent as
    seconds from now (15 minutes to 365 days).
  - `/app/invoices/<id>` reads only `GET /v1/profiles/{id}/invoices/{invoiceId}`: it has the client, and the public
    read needs the pay link's token (D-86). Its 404 also means another profile made the invoice.
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
  - A request with no answer in 30 s (the api's write timeout) fails, so the page offers Try again.
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
  (including the `check-status` and `invoice-progress` components); jobs → clients, invoices (the pay link's token
  pattern, Send to client); onboarding → activity, invoices, profiles,
  transactions; transactions → invoices (the bell's invoice events, R-81, the invoice numbers on Transactions, R-109, and the ECB currencies, R-111); transactions → profiles (the statement's way back from billing details, R-113). No cycles ([structure.md](structure.md)); money helpers and words that several features show live in
  `shared/lib/money.ts` and `shared/constants/money-copy.ts`. Add no new edge without listing it here.
- Payments imports invoice purpose, document and money schemas, plus its compact confirmation component and activity status constants.
- Shared financial representation stays with its existing owner.
- Payment verification classification lives with invoice money readers; checkout reuses it without changing financial safety gates.
- Payments owns operational queries, snapshots, problems, exports and reconciliation; link screens compose payments alongside offer details.
- Payment routes preserve profile identity in cache arguments and filter stores, sources, links and statuses through the API.
- Billing events retain their existing names; numberless checkout events navigate to Payments instead of invoice-only reads.
- Payment links' checkout (R-142) adds pay → links and links → invoices.
  - pay: the public link read and Pay, the link states, the USD pattern and the amount label.
  - links: the pay token's pattern in Pay's answer.
- Two more edges lead to stores: invoices → stores and pay → stores.
  - invoices: the store a merchant invoice records, its return-link origins and the brand's schema (R-134, R-135).
  - pay: the logo's address (R-135).
- invoices → profiles and stores → profiles: the token switches and their types (R-136).
- Team (R-139) leads to profiles (roles, permissions and the profile list) and to stores (the store names it offers).
- API keys (R-145) lead to profiles (the permission names its scopes reuse) and to stores (a merchant key's store).
- Links (R-140) lead to stores: a merchant's link names one of its stores, and the payer's read has its brand (R-142).
- balances → prices: My assets values each token at its market price (R-178).
- transactions → payments: the bell names a payment as the Payments list does.
- In-person checkout (`features/checkout`) leads to:
  - payments: the payment schema, its status words and the cache tag a new checkout refreshes.
  - links: the USD amount pattern.
  - stores: the stores a sale can belong to.
  - balances: the USD formatting of the amount shown to the customer.
- `/l/<slug>` and `/pay/<token>` share the `(checkout)` group, whose layout mounts one public store.
  - Pay on a link reads the new invoice into it, then opens the checkout, so it renders at once.
- `/embed/<token>?layout=full|element&origin=…&theme=light|dark` (R-168) is `/pay/<token>` in a merchant's page.
  - `PayScreen` takes `embed`: the page is as tall as its content, never the screen.
  - An element drops the title, items, note and PDF. The footer adds a link that opens `/pay/<token>` in a new tab.
  - `features/pay/hooks/use-embed-messages.ts` posts `ready`, `resize` and `status` to `origin` only (D-117).
  - Links that would load another page in the frame open a new tab, or the top page for the way back.
  - The embed listens to no message from its page.
- Checkout `/pay/<token>` (R-45) sits outside the `(app)` group: no Privy, no sign-in, `noindex`. A malformed token
  (an on-chain id too, D-86) is a 404; a token the API does not know shows the 404 page. It reads the public
  `GET /v1/invoices/{payToken}` every 15 s through a
  store whose requests carry no token (`providers/public-store-provider.tsx`). The browser recomputes the receive
  address from the terms with the factory and implementation built into the page (`features/pay/lib/receive-address.ts`,
  keccak256 from `@noble/hashes`, tested against the R-15 vectors) and shows no address on a mismatch. The terms'
  `invoiceId` must be keccak256 of the link's token (D-86). Token symbol and
  decimals come from `PAY_TOKENS` in the build, never the API; another token is refused, so enabling a token in the
  API also needs an entry there. The address and QR show only after the payer picks the network and presses Show
  address, with one line naming the exact token and network. A payer-chooses invoice (R-57) lists its `options`: until
  one has money the payer picks the network, then a token on it, with selects (`features/pay/components/option-picker.tsx`), and
  the page checks that option's terms with its own id, which must derive from the invoice id. Show address keeps the
  pick on the invoice (`PUT /v1/invoices/{payToken}/pick`), so the link opens on it and its address again; the URL
  carries no query. Session storage keeps a shown address for a reload in the same tab (R-68). Paid and settled come only from the API (D-29). It loads no
  third-party scripts ([money-safety.md](../backend/money-safety.md)).

## Tests

Vitest for logic, Playwright for flows, axe for accessibility, Lighthouse for performance (D-10, R-10, R-11).
- `pnpm e2e` runs deterministic browser tests without contacting Privy.
  - It also starts a stub api (`e2e/stub-api.mjs`) for the embed check and checkout sessions.
  - The build and the server both get the stub's `API_URL`, so no request reaches another api.
  - A request neither a test route nor the stub answers fails the run (`e2e/unmatched.ts`).
  - And the example merchant (`apps/example-merchant`), at an origin the stub lets frame a checkout (R-170).
- `pnpm --filter @forwend/web e2e:live` explicitly runs live sign-in tests using the configured test account.
- Live checks use `http://localhost:3000` and `API_URL`; stop existing servers first so verification runs the current source.
- CI has no test account and does not select live checks.
- The setup project signs in once and saves the session under ignored `test-results/`.
- Live spec files share that account and run sequentially to avoid Privy throttling.
Every run shares that account and the dev database, so its data must not pile up toward a profile cap (D-85).
Its invoices and requests close within 2 days, and Send to client is mocked.
A repeating invoice is stopped, and a job deleted, in the same test.
The api it starts has `API_USER_BURST=1000`: every test signs in as one user, so a person's limit would run out.
What is worth a test: [rules.md](rules.md).
