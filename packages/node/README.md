# forwend

The Forwend API for Node 20 or later, with no dependencies. It creates checkout sessions and invoices, reads payments
and stores, lists webhook events page by page, and verifies webhooks.

```sh
npm install forwend
```

```ts
import { Forwend, verifyWebhook } from "forwend";

const forwend = new Forwend({
  apiKey: process.env.FORWEND_KEY!,
  profileId: process.env.FORWEND_PROFILE_ID!,
  baseUrl: "https://forwend.com/api",
});

// A checkout for an order your server priced. The order's id as the key makes a retry safe.
const session = await forwend.checkoutSessions.create(
  { storeId, amountUsd: "25.00", reference: "order-1042",
    items: [{ description: "Coffee", quantity: "2", unitPrice: "12.50" }] },
  { idempotencyKey: "order-1042" },
);
// Redirect to session.payment.hostedUrl, or give session.payment.payToken to @forwend/js or @forwend/react.

// In your webhook route, with the raw request body:
const event = verifyWebhook({ payload: rawBody, headers, secrets: [process.env.FORWEND_WEBHOOK_SECRET!] });
// Then read the payment, and fulfil the order only when the API says it is paid.
const payment = await forwend.payments.get(session.payment.paymentId);
if (payment.paymentStatus === "paid") fulfil();
```

- `checkoutSessions`: `create`, `get`, `list`, `expire`. `payments`: `get`, with items, options and problems, and `list`.
- `invoices`: `create`, `get`, `list`, `cancel`, `reopen`, `send`. `stores`: `list`, `get`. `webhookEvents`: `list`.
- Lists are async iterables: `for await` reads every page. Payments filter by `reference`, `state`, `wallet` and more.
- `feesPaidBy` on an invoice or checkout create says who pays the fees: `owner`, deducted at settlement, or `client`,
  added on top of the price.
  - Left out, the profile's choice applies.
  - `GET /v1/profiles/{profileId}/fees` previews the fees for a price; the package has no method for it yet.
- Invoices, payments and each option carry `networkFee`, `platformFee` and `netAmount`, in the token's base units.
  - `netAmount` is the amount less both fees: what you receive.
- A payment's `amounts.settled` is what reached your wallet, net of fees; `amounts.fees` is what settlement paid in fees.
  - `observedRefunded` and `lastReturnTxHash` show held money sent back to the payer.
- A payment through NEAR Intents carries `crossChain`: 1Click's status, what the payer sent and both chains' transactions.
- The baseUrl must be https, or http on localhost. The key never goes anywhere else, and a redirect is refused.
- A rate limit is tried again, twice by default (`maxRetries`). So are a lost answer and a gateway error on a read,
  a create and a send.
  - A Retry-After over 60 seconds, such as a day until the next send, throws at once instead.
  - A create or send keeps its idempotency key on each try, so it never makes two.
  - A cancel, reopen or expire is not tried again after a lost answer: read the record to see if it happened.
  - Pass your own key, such as the order id, so a retry after a restart is safe too. A new purchase needs a new key.
- Each try times out after 30 seconds (`timeoutMs`).
- An error answer throws a `ForwendError` with the HTTP `status`, the API's `code` and `retryAfter` in seconds.

A `fw_live_` key works in live mode, on mainnets with real money. A `fw_test_` key works in test mode, on testnets.
Each payment's `livemode` says which. Docs: https://forwend.com/docs
