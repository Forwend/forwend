# forwend

The Forwend API for Node 20 or later, with no dependencies. It creates, reads and lists invoices, lists webhook
events page by page, and verifies webhooks.

```sh
npm install forwend
```

```ts
import { Forwend, verifyWebhook } from "forwend";

const forwend = new Forwend({
  apiKey: process.env.FORWEND_KEY ?? "",
  profileId: process.env.FORWEND_PROFILE_ID ?? "",
  baseUrl: "https://forwend.com/api",
});

const invoice = await forwend.invoices.create(
  { amountUsd: "1250.00", metadata: { order_id: "1042" } },
  { idempotencyKey: "order-1042" },
);

// In your webhook route, with the raw request body:
const event = verifyWebhook({ payload: rawBody, headers, secrets: [process.env.FORWEND_WEBHOOK_SECRET ?? ""] });
```

Every network is a testnet for now, so every key and invoice is in test mode. Docs: https://forwend.com/docs

Checkout and payment methods are available in the repository for the next release. npm 0.1.0 retains its original invoice methods.

```ts
const session = await forwend.checkoutSessions.create(
  { storeId, amountUsd: "25.00", reference: "order-1042",
    items: [{ description: "Coffee", quantity: "2", unitPrice: "12.50" }] },
  { idempotencyKey: "purchase-1042" },
);
// Redirect the customer to session.payment.hostedUrl.
const payment = await forwend.payments.get(session.payment.paymentId);
// Fulfill only after a verified event and canonical paymentStatus === "paid".
```

Use `checkoutSessions.get`, `.list` and `.expire` to manage attempts. `payments.list` includes purchases without invoice numbers.
Keep the same idempotency key after an uncertain response. A new purchase needs a fresh key.
