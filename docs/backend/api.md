# Backend API rules

Routes today: `/healthz`, `POST /v1/profiles/{profileId}/invoices`, `GET /v1/invoices/{invoiceId}` (public).

## Contract first

- `apps/backend/api/openapi.yaml` (OpenAPI 3.1) describes every route; change it before code.
- Go request and response types are written by hand in `internal/httpapi` until a generator is added (oapi-codegen
  for Go, openapi-typescript for web); keep them equal to the spec.

## Routes

- Prefix `/v1` (except `/healthz`). A breaking change means `/v2`.
- Plural nouns, IDs in the path: `/v1/profiles/{profileId}/invoices`, `/v1/invoices/{invoiceId}`.
- `GET` reads and never changes state. `POST` creates or runs an action (`POST /v1/invoices/{id}/cancel`).
- Invoice terms and ledger entries are immutable. Transfer and invoice statuses change through validated worker
  transitions. Clients cannot edit money records with `PUT` or `DELETE`.

## Requests and responses

- JSON fields in camelCase. Unknown fields are rejected. Bodies go through `http.MaxBytesReader` (1 MB).
- The server sets `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout` and `IdleTimeout`.
- Money: decimal string in base units (`"5000000"`) next to `chainId` and `token` (contract address), as in R-19.
- Times: RFC 3339 in UTC. IDs and addresses: strings.
- Lists: `?limit=` (max 100) and `?cursor=`; response `{ "items": [...], "nextCursor": "…" }`.

## Idempotency

- Every `POST` that creates something or moves money needs an `Idempotency-Key` header.
- First call: 201. Same key and body again: 200 with the same resource. Same key, other body: 409.
- Keys are unique per profile, 1–255 characters; a missing or longer key is 400. The server stores a SHA-256 of the
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
- `httpapi.requireUser` and `requireProfileOwner` wrap the protected handlers.

## Errors

- One shape: `{ "error": { "code": "invoice_not_found", "message": "…" } }`. Codes are snake_case and listed in the spec.
- 400 malformed, 401 no or bad token, 403 not yours, 404 missing, 409 conflict, 422 invalid value, 500 anything else.
- A 500 never shows internal details. `httpapi` maps sentinel errors to codes in one place.

## Handlers and tests

- One file per feature in `internal/httpapi`: parse, call the service, write JSON. No SQL, no business rules.
- Each route has a test for success and for every error code it can return, on real Postgres.
