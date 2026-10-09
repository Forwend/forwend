# Backend API rules

## Contract first

- `api/openapi.yaml` (OpenAPI 3.1, repo root) is the source of truth. Change it first, then the code.
- Go server types are generated with oapi-codegen; the web client with openapi-typescript.

## Routes

- Prefix `/v1` (except `/healthz`). A breaking change means `/v2`.
- Plural nouns, IDs in the path: `/v1/profiles/{profileId}/invoices`, `/v1/invoices/{invoiceId}`.
- `GET` reads and never changes state. `POST` creates or runs an action (`POST /v1/invoices/{id}/cancel`).
- Invoice terms, transfers and ledger entries never change: no `PUT` or `DELETE` on them. Status changes come from
  the worker, not from clients.

## Requests and responses

- JSON fields in camelCase. Unknown fields are rejected. Bodies go through `http.MaxBytesReader` (1 MB).
- The server sets `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout` and `IdleTimeout`.
- Money: decimal string in base units (`"5000000"`) next to `chainId` and `token` (contract address), as in R-19.
- Times: RFC 3339 in UTC. IDs and addresses: strings.
- Lists: `?limit=` (max 100) and `?cursor=`; response `{ "items": [...], "nextCursor": "…" }`.

## Idempotency

- Every `POST` that creates something or moves money needs an `Idempotency-Key` header.
- First call: 201. Same key and body again: 200 with the same resource. Same key, other body: 409.

## Auth

- `Authorization: Bearer <Privy access token>`, checked by middleware on every route.
- Public routes (checkout reads) are marked `security: []` in the spec. Nothing else is public.
- Profile-scoped routes check that the user owns the profile: 403 otherwise.

## Errors

- One shape: `{ "error": { "code": "invoice_not_found", "message": "…" } }`. Codes are snake_case and listed in the spec.
- 400 malformed, 401 no or bad token, 403 not yours, 404 missing, 409 conflict, 422 invalid value, 500 anything else.
- A 500 never shows internal details. `httpapi` maps sentinel errors to codes in one place.

## Handlers and tests

- One file per feature in `internal/httpapi`: parse, call the service, write JSON. No SQL, no business rules.
- Each route has a test for success and for every error code it can return, on real Postgres.
