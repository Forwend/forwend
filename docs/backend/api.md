# Backend API rules

Routes today: `/healthz`, `POST /v1/me`, `GET /v1/me`, `POST /v1/me/onboarding`, `POST /v1/profiles`,
`PUT /v1/profiles/{profileId}/billing-details`, `GET /v1/profiles/{profileId}/billing-details`,
`POST /v1/profiles/{profileId}/invoices`,
`GET /v1/profiles/{profileId}/invoices`, `GET /v1/profiles/{profileId}/invoices/{invoiceId}`,
`GET /v1/profiles/{profileId}/balances`, `GET /v1/profiles/{profileId}/activity`,
`GET /v1/profiles/{profileId}/transactions`, `GET /v1/profiles/{profileId}/balance-history`,
`GET /v1/invoices/{invoiceId}`, `GET /v1/invoices/{invoiceId}/invoice.pdf`, `GET /v1/invoices/{invoiceId}/receipt.pdf`
(the last three public).

## Contract first

- `apps/backend/api/openapi.yaml` (OpenAPI 3.1) describes every route; change it before code.
- Go request and response types are written by hand in `internal/httpapi` until a generator is added (oapi-codegen
  for Go); the web app's are in its features (`apps/web/src/features/*/`, see docs/web/architecture.md). Keep them equal to the spec.

## Routes

- Prefix `/v1` (except `/healthz`). A breaking change means `/v2`.
- Plural nouns, IDs in the path: `/v1/profiles/{profileId}/invoices`, `/v1/invoices/{invoiceId}`.
- `GET` reads and never changes state. `POST` creates or runs an action (`POST /v1/invoices/{id}/cancel`).
- `PUT` creates or replaces a whole editable resource (billing details).
- Invoice terms and ledger entries are immutable. Transfer and invoice statuses change through validated worker
  transitions. Clients cannot edit money records with `PUT` or `DELETE`.

## Requests and responses

- JSON fields in camelCase. Unknown fields are rejected. Bodies go through `http.MaxBytesReader` (1 MB).
- The server sets `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout` and `IdleTimeout`.
- Money: decimal string in base units (`"5000000"`) next to `chainId` and `token` (contract address), as in R-19.
- Times: RFC 3339 in UTC. IDs and addresses: strings.
- Lists: `?limit=` (max 100) and `?cursor=`; response `{ "items": [...], "nextCursor": "…" }`.

## First run

R-50 and D-53; the full schema is in openapi.yaml. `POST` and `GET /v1/me` return `onboardedAt`: null until the user
makes or skips the first-run choice, and the web app shows the choice while it is null. Users who signed up before the
column existed were set to their signup time (migration 00013), so they never see it.

- `POST /v1/me/onboarding` with `{ "choices": [...] }`, any of `receive_and_send` (the personal profile every user
  has), `get_paid_by_clients` (a freelancer profile), `accept_business_payments` and `build_integration` (one merchant
  profile for either or both: an integration runs on a merchant profile). An empty list is Skip. A missing or unknown
  choice is 422 `invalid_value`.
- One transaction locks the user row, makes the profiles and sets `onboarded_at`, so concurrent calls make them once.
  Then each new profile gets its wallet through the signup path (R-31, R-32). The first call answers 201; later calls,
  with any choices, change nothing and answer 200 with the same `Me`. Later profiles come from `POST /v1/profiles`.

## Billing details

R-43; the full schema is in openapi.yaml. Owner only, like every `{profileId}` route.

- `PUT /v1/profiles/{profileId}/billing-details` creates or replaces them and answers 200 with what was saved. Body:
  `name` (≤ 200 characters), `address` (≤ 500), `country` (an assigned ISO 3166-1 alpha-2 code in upper case, like
  `DE`), `email` (≤ 254, a plain address) and optional `taxId` (≤ 50). All but `taxId` are required, so an invoice or
  PDF always has a full issuer block; a `taxId` left out or empty means none and is returned as null. Every field is
  replaced. Characters, not bytes; no NUL. A missing or broken field is 422 `invalid_value`. No Idempotency-Key: the
  same body sent twice saves the same details.
- `GET` returns the same fields plus `updatedAt`; 404 `billing_details_not_found` until the first `PUT`.
- The invoice insert copies the details into the invoice as `issuer`, in the same statement that takes the number,
  so the copy is the details at that moment. Editing them later changes no invoice. A profile without details gives
  `issuer: null`.

## Invoices

R-19 and R-42; the full schema is in openapi.yaml.

- `number` is an integer per profile: 1, 2, … in creation order (D-50). The API never formats it; the web shows
  `INV-` and at least 4 digits (`INV-0001`). The insert takes it from the profile's counter row (`profiles.invoice_seq`)
  in the invoice's own transaction, so a failed create uses no number and a repeated Idempotency-Key returns the
  stored one.
- Optional create fields: `title` (≤ 200 characters), `note` (≤ 2000), `dueDate` (`YYYY-MM-DD`, shown only; payment
  still closes at `expiresAt`), `senderName` (≤ 100; the name the payer sees on a request from a profile without
  billing details, D-52) and `client` `{ name ≤ 200, email ≤ 254, address ≤ 500 }`. Empty means none and is
  returned as null. Characters, not bytes; no NUL. `email` is a plain address (`name@example.com`). A broken rule is
  422 `invalid_value`; these fields are part of the idempotency hash.
- The number, these fields and `issuer` never change, like the terms: a database trigger rejects any update.
- `settlementTxHash` is the signer's settle transaction once the invoice is settled; null before, and when the refund
  authority settled the receiver outside the signer. The activity's invoice items carry it as `txHash`.
- An invoice read alone (either GET, and create) also has `paidAt` and `settledAt`, null until reached. `paidAt`
  is the receipt's paid time (below); `settledAt` is when the settlement was recorded as final: the `created_at` of
  the ledger's settlement transaction, written with `settlementStatus = settled`. List items have neither.
- `GET /v1/profiles/{profileId}/invoices?limit=&cursor=`: the list format above, highest number (newest) first; items
  have no `deposits`. Owner only, like every `{profileId}` route.
- `GET /v1/profiles/{profileId}/invoices/{invoiceId}`: the public GET plus `client`. Another profile's invoice is 404
  (`invoice_not_found`), also when the same user owns both.
- The public `GET /v1/invoices/{invoiceId}` gives the payer the number, title, note, due date, `senderName` and
  `issuer` (who bills them; the issuer's own business details) but no `client`: the id is a bearer link, so it returns
  only what the payer needs (OWASP API Security Top 10 2023, API3). Create, list and the profile's GET, which only the
  owner calls, include `client`.

## Invoice and receipt PDFs

R-47 and D-51; the full description is in openapi.yaml. Both are public like `GET /v1/invoices/{invoiceId}` and
answer 404 `invoice_not_found` the same way.

- `internal/document` draws them with `codeberg.org/go-pdf/fpdf` in a fixed layout, from `invoice.Get` only: no
  templates, network or file reads. The font is Noto Sans, embedded (`internal/document/fonts`, SIL OFL 1.1). Long
  texts wrap and are cut with "…"; characters above U+FFFF (emoji) print as "?".
- `invoice.pdf`: number (`INV-0001`), title, issuer block from the invoice's copy (left out without one), "Bill to"
  with the client's name and address but never the email (the id is a bearer link), the exact amount with the token's
  symbol and decimals, network (chain name and id), due date, checkout expiry, created time, note, invoice id and the
  pay link `PUBLIC_WEB_URL/pay/<invoiceId>`.
- `receipt.pdf`: 409 `invoice_not_paid` until `paymentStatus` is `paid` (it stays paid once settled). Adds the paid
  time, the confirmed deposits' tx hashes and amounts, the settlement status and `settlementTxHash`, and says to
  check the receipt at the pay link, since a PDF can be edited. The paid time is the block time of the last deposit
  the ledger booked to `recipient_payable`: the one that completed the amount.
- The same data gives the same bytes (creation date = created or paid time, sorted catalog), so the `ETag` is a hash of
  the file. `Cache-Control: private, no-cache`: a client revalidates and gets 304 while the file is unchanged; a late
  deposit or the settlement changes the receipt. `Content-Disposition: attachment;
  filename="forwend-INV-0001-invoice.pdf"` (or `-receipt.pdf`).

## Wallet transactions and balance history

Both read the transfers the worker records for profile wallets (R-38); the full schema is in openapi.yaml.

- `GET /v1/profiles/{profileId}/transactions?limit=&cursor=`: the list format above, newest block time first, reorged
  transfers left out. An item: `chainId`, `token`, `symbol`, `decimals`, `direction` (`in` | `out`), `amount`,
  `counterparty` (sender for in, receiver for out), `txHash`, `logIndex`, `blockNumber`, `at` (block time), `status`
  (`detected` | `confirmed`, as for deposits).
- `GET /v1/profiles/{profileId}/balance-history?days=N`: N is 1–365, default 30 (not a number: 400; out of range: 422).
  One point per UTC day, today included, oldest first: `points[i]` is `{ at, estimatedUsd, receivedUsd, sentUsd }`,
  and `tokens[j]` is `{ chainId, token, symbol, decimals, balances, received, sent }`, where each array holds one
  base-unit string per point. `at` is the end of the day (00:00 UTC of the next day); the last point is now, and its
  balance is the wallet balance `/balances` reads at the second RPC's finalized block. An earlier balance undoes the
  final transfers after it (not reorged, at or below that block); `received` and `sent` sum them per day, today's
  without an end. A missing wallet balance makes that token's arrays and every USD total null. Money moved without a
  token `Transfer` log (Arc native-coin sends, fees paid in the token) is not undone; a balance below 0 shows 0.

## Idempotency

- Every `POST` that creates something or moves money needs an `Idempotency-Key` header. Exceptions: `POST /v1/me`
  (signup) and `POST /v1/me/onboarding` happen once per user, so the user's token is the key.
- First call: 201. Same key and body again: 200 with the same resource. Same key, other body: 409.
- Keys are unique per profile (per user for `POST /v1/profiles`), 1–255 characters; a missing or longer key is 400. The server stores a SHA-256 of the
  normalized values, never the body, so field order, spacing and address letter case don't matter. A request that
  fails validation stores nothing. Two requests with one key at once get one resource.

## Auth

- `Authorization: Bearer <Privy access token>`, checked by middleware on every route.
- Public routes (checkout reads) are marked `security: []` in the spec. `/healthz` is also public and uses its own status response. No other route is public by default.
- Profile-scoped routes check that the user owns the profile: 403 otherwise, also for an unknown or malformed
  profile ID, so callers can't probe which profiles exist.
- `internal/auth` verifies the token locally: ES256 only, issuer `privy.io`, audience = app ID, `exp` required,
  `sub` = the user's Privy DID. The key is the one named by the token's `kid` among those published at
  `PRIVY_JWKS_URL` (Privy publishes more than one), loaded at startup (R-29). An unknown `kid` fetches the keys again at
  most once a minute; a known one makes no network call while the list is younger than an hour. An older list is
  fetched again first, so a key Privy withdrew stops verifying (R-30); if Privy is unreachable, the last list is kept. The Privy Go SDK (D-12) has no local token check, so this
  uses `golang-jwt/jwt/v5` as in Privy's Go guide (https://docs.privy.io/authentication/user-authentication/access-tokens).
- `httpapi.requireUser` and `requireProfileOwner` wrap the protected handlers. `/v1/me` and `POST /v1/profiles` act
  only for the token's user. Every `{profileId}` route is listed in `profileRoutes` in `profiles_test.go`, which checks
  that another user gets 403 on each.

## Errors

- One shape: `{ "error": { "code": "invoice_not_found", "message": "…" } }`. Codes are snake_case and listed in the spec.
- 400 malformed, 401 no or bad token, 403 not yours, 404 missing, 409 conflict, 422 invalid value, 429 too many
  requests, 500 anything else.
- A 500 never shows internal details. `httpapi` maps sentinel errors to codes in one place.

## Rate limits

`internal/httpapi/ratelimit.go`, constants there. Each caller has a token bucket: a request takes a token, tokens
come back at a fixed rate up to the burst size. An empty bucket answers 429 `rate_limited` with `Retry-After` in whole
seconds (when the next token is back) and runs nothing else.

- Routes that need a token: per Privy user, after the token is checked; 2 requests a second, 60 at once. A dashboard
  tab polls about six routes every 15 s and a page load sends about ten at once, so several tabs stay well under it.
- Public routes (`GET /v1/invoices/{invoiceId}` and both PDFs) have no limit in the api. Next's `/api` rewrite does
  not set `X-Forwarded-For`, so the api sees one address for every payer and cannot trust a client's header. Limit them
  per IP at the load balancer or edge once hosting is chosen (Q-8), and keep the api reachable only through it.
  `/healthz` has no limit.
- The buckets live in each api process (D-72): with N replicas behind a load balancer a caller gets up to N times the
  rate. Redis can hold the counts once more than a few replicas run.
- The web waits `Retry-After` and sends the request once more; if that is refused too, its reads pause 15 s, doubling
  with each refusal up to 5 min, until an answer is not a 429 (`apps/web/src/shared/api/rate-limit.ts`).

## Handlers and tests

- One file per feature in `internal/httpapi`: parse, call the service, write JSON. No SQL, no business rules.
- Each route has a test for success and for every error code it can return, on real Postgres.
