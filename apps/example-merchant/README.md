# Example shop

A small shop that takes stablecoin payments through Forwend, end to end. Use it as a quickstart for your own site.

- The browser sends item ids and quantities. The server prices the cart from its own catalog (`src/lib/catalog.ts`).
- The server creates a Forwend checkout session for that amount, with the order id as `reference` (`src/app/api/orders/route.ts`).
- The order page offers three ways to pay, in the shop's light theme (`src/components/order-checkout.tsx`):
  - the pay panel in the page (`PaymentElement`),
  - the whole checkout in the page (`Checkout`),
  - a link to Forwend's own page (`PayButton`).
- The order turns paid only on the server, never from the page (`src/lib/webhook.ts`):
  - a webhook must carry a valid signature;
  - the shop then reads the session from the API, and ships only when the API says it is paid;
  - an order ships once, so a repeated, late or reordered event changes nothing.
- New orders are limited: 5 per visitor and 20 for the whole shop every 10 minutes (`src/app/api/orders/route.ts`).
  - Each checkout takes from the profile's checkout quota, so orders nobody pays must not use it up.
  - A checkout closes after 15 minutes. One that closed unpaid frees its place in the quota.
  - A visitor is told apart only by `TRUST_PROXY_HEADER`, a header your own proxy sets. Without one, only the shop's limit applies.
- The pages send a Content-Security-Policy: scripts only from the shop, inline ones included as Next needs, and frames only from Forwend.

## Run it

1. In Forwend, on a merchant profile:
   - make a secret key with `invoices.read` and `invoices.write`;
   - add this shop's origin, `http://localhost:3100`, to the store's allowed origins;
   - add a webhook endpoint for `invoice.paid` at a public address that reaches `/api/webhooks/forwend`.
2. Copy `.env.example` to `.env` and fill it in.
3. `pnpm --filter @forwend/example-merchant build`, then `pnpm --filter @forwend/example-merchant start`.
4. Open http://localhost:3100. For development, `pnpm --filter @forwend/example-merchant local` runs `next dev`.

`FORWEND_URL` is read when the shop is built, for its frame policy: build again after you change it.

## Limits

- It uses the `forwend` package from this repository: npm's `forwend` 0.1.0 has no checkout methods yet.
- Orders live in one SQLite file (`EXAMPLE_DATABASE`). A real shop keeps them in its own database.
- Every network is a testnet for now, so every checkout is in test mode.

Browser tests: `apps/web/e2e/example-merchant.spec.ts`, against Forwend's real checkout frame and a stub api.
